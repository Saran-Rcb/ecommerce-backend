import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { diskStorage, MulterError } from 'multer';
import type { Response } from 'express';
import type { Multer } from 'multer';
import { v4 as uuidv4 } from 'uuid';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ORDER_STATUSES } from '../orders/dto/update-order-status.dto';
import { CreateWholesaleOrderDto } from './dto/create-wholesale-order.dto';
import {
  VerifyWholesalePaymentDto,
  WholesaleGuestKeyDto,
} from './dto/wholesale-payment.dto';
import {
  UpdateWholesaleStatusDto,
  type WholesaleStatusValue,
} from './dto/update-wholesale-status.dto';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { WholesaleService, type Actor } from './wholesale.service';
import {
  MAX_DESIGN_BYTES,
  MAX_DESIGN_FILES,
  WHOLESALE_DESIGN_DIR,
  assertAllowedDesign,
  designContentType,
  designExtension,
  resolveDesignPath,
} from './wholesale-storage';

@Catch(MulterError)
class WholesaleUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const megabytes = Math.round(MAX_DESIGN_BYTES / 1024 / 1024);

    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? `Each design file must be ${megabytes}MB or smaller`
        : exception.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Upload the artwork in a "designs" field (max ${MAX_DESIGN_FILES} files)`
          : exception.message;

    response.status(400).json({
      statusCode: 400,
      message,
      error: 'Bad Request',
    });
  }
}

// Quotes and browser-suggested file names are untrusted; anything landing in a
// download header has to be reduced to a safe token first.
function safeDownloadName(originalName: string): string {
  const cleaned = originalName.replace(/[^\w.+-]/g, '_').slice(0, 120);
  return cleaned || 'design';
}

function parseId(raw: string): number {
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('A numeric record id is required.');
  }

  return id;
}

function parseStatusFilter(raw?: string): WholesaleStatusValue | undefined {
  if (!raw || raw === 'ALL') return undefined;

  if (!(ORDER_STATUSES as readonly string[]).includes(raw)) {
    throw new BadRequestException('Unknown wholesale status filter.');
  }

  return raw as WholesaleStatusValue;
}

@Controller('wholesale')
export class WholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  // ==========================================
  // ADMIN — declared before the parametric customer
  // routes so no ':reference' pattern can shadow them
  // ==========================================

  @Get('admin/orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  adminList(@Query('search') search?: string, @Query('status') status?: string) {
    return this.wholesale.adminList({
      search,
      status: parseStatusFilter(status),
    });
  }

  @Get('admin/orders/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  adminDetail(@Param('id') id: string) {
    return this.wholesale.adminDetail(parseId(id));
  }

  @Patch('admin/orders/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  adminStatus(
    @Param('id') id: string,
    @Body() dto: UpdateWholesaleStatusDto,
  ) {
    return this.wholesale.adminUpdateStatus(parseId(id), dto.status);
  }

  // ==========================================
  // DESIGN DELIVERY
  //
  // Guarded by a signed, expiring link instead of a bearer token so that an
  // inline preview and a download both work without exposing the directory.
  // ==========================================

  @Get('designs/:id')
  async deliverDesign(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('exp') exp: string,
    @Query('sig') sig: string | undefined,
    @Query('download') download: string | undefined,
  ) {
    const design = await this.wholesale.getAuthorizedDesign(
      parseId(id),
      Number(exp),
      sig,
    );

    const absolute = resolveDesignPath(design.filePath);

    if (!existsSync(absolute)) {
      throw new NotFoundException(
        'The stored design file is no longer present on this server.',
      );
    }

    const contentType = designContentType(design.filePath);
    const wantsDownload = download === '1';
    const disposition = wantsDownload ? 'attachment' : 'inline';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', design.size);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${safeDownloadName(design.originalName)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');

    if (contentType === 'image/svg+xml' && !wantsDownload) {
      // An SVG opened at the top level can carry script. Inside an <img> it
      // cannot, but the "Open" link does exactly that, so the response is
      // sandboxed and given no network access of its own.
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      );
    }

    createReadStream(absolute).pipe(res);
  }

  // ==========================================
  // CUSTOMER
  // ==========================================

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @UseFilters(new WholesaleUploadExceptionFilter())
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'designs', maxCount: MAX_DESIGN_FILES }],
      {
        storage: diskStorage({
          destination: (req, file, cb) => {
            try {
              mkdirSync(WHOLESALE_DESIGN_DIR, { recursive: true });
              cb(null, WHOLESALE_DESIGN_DIR);
            } catch (error) {
              cb(error as Error, WHOLESALE_DESIGN_DIR);
            }
          },
          filename: (req, file, cb) => {
            // The extension is re-checked here so the stored name can only ever
            // end in one of the four allowlisted types.
            cb(null, `${uuidv4()}${designExtension(file.originalname)}`);
          },
        }),
        fileFilter: (req, file, cb) => {
          try {
            assertAllowedDesign(file.originalname);
            cb(null, true);
          } catch (error) {
            cb(error as Error, false);
          }
        },
        limits: {
          fileSize: MAX_DESIGN_BYTES,
          files: MAX_DESIGN_FILES,
        },
      },
    ),
  )
  create(
    @Req() req: { user?: Actor },
    @Body() dto: CreateWholesaleOrderDto,
    @UploadedFiles() files?: { designs?: Multer.File[] },
  ) {
    return this.wholesale.createSubmission(req.user, dto, files ?? {});
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  myOrders(@Req() req: { user?: Actor }) {
    return this.wholesale.myOrders(req.user);
  }

  @Get(':reference/status')
  @UseGuards(OptionalJwtAuthGuard)
  status(
    @Req() req: { user?: Actor },
    @Param('reference') reference: string,
    @Query() guest: WholesaleGuestKeyDto,
  ) {
    return this.wholesale.statusForOwner(reference, guest, req.user);
  }

  @Post(':reference/payment-order')
  @UseGuards(OptionalJwtAuthGuard)
  paymentOrder(
    @Req() req: { user?: Actor },
    @Param('reference') reference: string,
    @Body() guest: WholesaleGuestKeyDto,
  ) {
    return this.wholesale.createPaymentOrder(reference, guest, req.user);
  }

  @Post(':reference/payment/verify')
  @UseGuards(OptionalJwtAuthGuard)
  verifyPayment(
    @Req() req: { user?: Actor },
    @Param('reference') reference: string,
    @Body() dto: VerifyWholesalePaymentDto,
  ) {
    return this.wholesale.verifyPayment(reference, dto, req.user);
  }
}
