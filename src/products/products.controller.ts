import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage, MulterError } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Multer } from 'multer';

import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Catch(MulterError)
class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? 'Each image must be 5MB or smaller'
        : exception.message;
    response.status(400).json({
      statusCode: 400,
      message,
      error: 'Bad Request',
    });
  }
}

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
  ) {}

  // Get all products - PUBLIC
  @Get()
  getProducts() {
    return this.productsService.getAllProducts();
  }

  // Get all categories - PUBLIC
  @Get('categories')
  getCategories() {
    return this.productsService.getCategories();
  }

  // Get product by slug - PUBLIC (must come before :id)
  @Get('slug/:slug')
  getProductBySlug(@Param('slug') slug: string) {
    return this.productsService.getProductBySlug(slug);
  }

  // Get current logged-in user (must come before :id)
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(@Req() req: any) {
    return req.user;
  }

  // Get one product by ID - PUBLIC
  @Get(':id')
  getProductById(@Param('id') id: string) {
    return this.productsService.getProductById(Number(id));
  }

  // Create product - ADMIN only
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createProduct(@Body() createProductDto: CreateProductDto) {
    return this.productsService.createProduct(createProductDto);
  }

  // Upload product images - ADMIN only
  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseFilters(new MulterExceptionFilter())
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 10 },
      ],
      {
        storage: diskStorage({
          destination: './uploads/products',
          filename: (req, file, cb) => {
            const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
            cb(null, uniqueName);
          },
        }),
        fileFilter: (req, file, cb) => {
          const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
          if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException(
                'Only JPEG, PNG, WEBP and GIF images are allowed',
              ),
              false,
            );
          }
        },
        limits: {
          fileSize: 5 * 1024 * 1024, // 5MB
        },
      },
    ),
  )
  async uploadImages(@UploadedFiles() files: { images?: Multer.File[] }) {
    if (!files?.images?.length) {
      throw new BadRequestException('At least one image is required');
    }
    if (files.images.length > 10) {
      throw new BadRequestException('Maximum 10 images allowed');
    }
    const uploaded = files.images.map((file) => ({
      url: `/uploads/products/${file.filename}`,
      filename: file.filename,
      size: file.size,
    }));
    return { files: uploaded, urls: uploaded.map((f) => f.url) };
  }

  // Update product - ADMIN only
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(
      Number(id),
      updateProductDto,
    );
  }

  // Delete product - ADMIN only
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteProduct(@Param('id') id: string) {
    return this.productsService.deleteProduct(Number(id));
  }
}