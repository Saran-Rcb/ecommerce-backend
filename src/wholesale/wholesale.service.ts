import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { unlink } from 'fs';
import type { Multer } from 'multer';

import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayService } from '../payments/razorpay.service';
import { ALLOWED_TRANSITIONS } from '../orders/order-lifecycle';
import type { OrderStatusValue } from '../orders/dto/update-order-status.dto';
import { CreateWholesaleOrderDto } from './dto/create-wholesale-order.dto';
import { WholesaleGuestKeyDto } from './dto/wholesale-payment.dto';
import type { WholesaleStatusValue } from './dto/update-wholesale-status.dto';
import { quoteWholesale } from './wholesale-pricing';
import {
  MAX_DESIGN_FILES,
  constantTimeEquals,
  designContentType,
  signDesignAccess,
  verifyDesignAccess,
} from './wholesale-storage';

const DESIGN_LINK_TTL_SECONDS = 2 * 60 * 60;

const WHOLESALE_INCLUDE = {
  designs: { orderBy: { id: 'asc' as const } },
  user: {
    select: { id: true, name: true, email: true, phone: true },
  },
} satisfies Prisma.WholesaleOrderInclude;

type WholesaleOrderWithRelations = Prisma.WholesaleOrderGetPayload<{
  include: typeof WHOLESALE_INCLUDE;
}>;

export type Actor = {
  userId: number;
  email: string;
  role: string;
};

export type DesignFile = {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  filePath: string;
  createdAt: Date;
};

@Injectable()
export class WholesaleService {
  private readonly logger = new Logger(WholesaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly razorpay: RazorpayService,
  ) {}

  // ==========================================
  // INTERNAL HELPERS
  // ==========================================

  // Design links are signed with the deployment's existing secret but a
  // domain-separated message, so no new credential has to be managed.
  private get linkSecret(): string {
    const secret = this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new BadRequestException(
        'Wholesale design links cannot be issued without JWT_SECRET.',
      );
    }

    return secret;
  }

  private designLinks(design: DesignFile) {
    const { expiresAt, sig } = signDesignAccess(
      this.linkSecret,
      design.id,
      DESIGN_LINK_TTL_SECONDS,
    );

    const base = `/wholesale/designs/${design.id}`;

    return {
      id: design.id,
      originalName: design.originalName,
      mimeType: design.mimeType,
      size: design.size,
      filePath: design.filePath,
      createdAt: design.createdAt,
      viewUrl: `${base}?exp=${expiresAt}&sig=${sig}`,
      downloadUrl: `${base}?exp=${expiresAt}&sig=${sig}&download=1`,
      linkExpiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  // Derived only from values that actually exist, so the admin list can never
  // show a payment state the database does not support.
  private paymentView(order: {
    totalAmount: number;
    currency: string;
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
    paidAt: Date | null;
  }) {
    return {
      status: order.razorpayPaymentId
        ? 'PAID'
        : order.razorpayOrderId
          ? 'ORDER_CREATED'
          : 'UNPAID',
      amount: order.totalAmount,
      currency: order.currency,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId,
      paidAt: order.paidAt,
    };
  }

  // Retail and wholesale share one machine, with one deliberate difference:
  // a bulk request is normally settled by wire transfer or cheque, so the admin
  // may confirm payment by hand. That writes only `status` — no Razorpay order
  // id, payment id, signature or paidAt — so the payment panel keeps reporting
  // gateway facts exactly as they are and never shows a capture that did not
  // happen. Retail keeps PAID gateway-only because there PAID is the receipt.
  private nextStatuses(status: WholesaleStatusValue): WholesaleStatusValue[] {
    const shared = ALLOWED_TRANSITIONS[status as OrderStatusValue] ?? [];

    if (status === 'PENDING' && !shared.includes('PAID' as OrderStatusValue)) {
      return ['PAID', ...shared];
    }

    return shared;
  }

  private asAdminView(order: WholesaleOrderWithRelations) {
    // accessKey is the guest's only proof of ownership, so it stays off every
    // admin payload: browser history, caches and logs must not hold a replayable
    // capability for an order the admin already sees without it.
    const { accessKey: _hidden, ...publicOrder } = order;
    return {
      ...publicOrder,
      designs: order.designs.map((design) => this.designLinks(design)),
      payment: this.paymentView(order),
      nextStatuses: this.nextStatuses(order.status),
    };
  }

  // A wrong reference and an order belonging to someone else answer
  // identically on purpose: WH-#### values are sequential and must not be
  // enumerable by probing which ones return 403.
  private async findForActor(
    reference: string,
    actor: Actor | undefined,
    accessKey?: string,
  ): Promise<WholesaleOrderWithRelations> {
    const order = await this.prisma.wholesaleOrder.findUnique({
      where: { reference },
      include: WHOLESALE_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Wholesale order not found.');
    }

    if (actor?.role === 'ADMIN') return order;
    if (order.userId && actor?.userId === order.userId) return order;

    if (accessKey && constantTimeEquals(accessKey, order.accessKey)) {
      return order;
    }

    throw new NotFoundException('Wholesale order not found.');
  }

  private async findDesignOrThrow(id: number) {
    const design = await this.prisma.wholesaleDesign.findUnique({
      where: { id },
    });

    if (!design) {
      throw new NotFoundException('Design not found.');
    }

    return design;
  }

  // ==========================================
  // SUBMISSION
  // ==========================================

  async createSubmission(
    actor: Actor | undefined,
    dto: CreateWholesaleOrderDto,
    files: { designs?: Multer.File[] },
  ) {
    const uploaded = files?.designs ?? [];

    if (uploaded.length === 0) {
      throw new BadRequestException(
        'Attach your design file (PNG, AI, PSD or SVG).',
      );
    }

    if (uploaded.length > MAX_DESIGN_FILES) {
      throw new BadRequestException(
        `A maximum of ${MAX_DESIGN_FILES} design files can be attached.`,
      );
    }

    // The payable figure is calculated here and nowhere else. Nothing on the
    // request body is allowed to influence it.
    const quote = quoteWholesale(dto.quantity);

    const account = actor?.userId
      ? await this.prisma.user.findUnique({
          where: { id: actor.userId },
          select: { name: true, email: true, phone: true },
        })
      : null;

    const email = (dto.contactEmail || account?.email || '')
      .trim()
      .toLowerCase();

    if (!email) {
      throw new BadRequestException('An email address is required.');
    }

    const accessKey = randomBytes(24).toString('base64url');
    const sizes = Array.from(
      new Set(dto.sizes.map((size) => size.trim()).filter(Boolean)),
    );

    if (sizes.length === 0) {
      throw new BadRequestException('Select at least one size.');
    }

    // The reference is derived from the autoincrement id, so the row is created
    // under an unguessable placeholder and renamed in the same transaction.
    // Neither a WH-less record nor a placeholder can ever be committed.
    const placeholder = `TMP-${randomBytes(9).toString('hex')}`;

    let order: WholesaleOrderWithRelations;

    try {
      order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.wholesaleOrder.create({
          data: {
            reference: placeholder,
            userId: actor?.userId ?? null,
            contactName: trimOrNull(dto.contactName) ?? account?.name ?? null,
            contactEmail: email,
            contactPhone:
              trimOrNull(dto.contactPhone) ?? account?.phone ?? null,
            company: trimOrNull(dto.company),
            garment: dto.garment.trim(),
            fabric: dto.fabric.trim(),
            colorway: dto.colorway.trim(),
            sizes,
            quantity: quote.quantity,
            notes: trimOrNull(dto.notes),
            unitPrice: quote.unitPrice,
            totalAmount: quote.totalAmount,
            currency: quote.currency,
            accessKey,
            designs: {
              create: uploaded.map((file) => ({
                filePath: file.filename,
                originalName: file.originalname,
                mimeType: designContentType(file.filename),
                size: file.size,
              })),
            },
          },
        });

        return tx.wholesaleOrder.update({
          where: { id: created.id },
          data: {
            reference: `WH-${String(created.id).padStart(4, '0')}`,
          },
          include: WHOLESALE_INCLUDE,
        });
      });
    } catch (error) {
      // Multer has already written the bytes, so a rejected insert must not
      // leave private artwork sitting on disk with nothing pointing at it.
      this.discardUploadedDesigns(uploaded);
      throw error;
    }

    this.logger.log(
      `Wholesale ${order.reference}: ${quote.quantity} units quoted at ${quote.currency} ${quote.totalAmount}`,
    );

    return {
      message: 'Wholesale request stored.',
      // The guest needs this to pay and to read their own request later; a
      // signed-in customer is already covered by their JWT.
      accessKey: actor?.userId ? null : accessKey,
      order: this.asCustomerView(order),
    };
  }

  private asCustomerView(order: WholesaleOrderWithRelations) {
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      garment: order.garment,
      fabric: order.fabric,
      colorway: order.colorway,
      sizes: order.sizes,
      quantity: order.quantity,
      contactEmail: order.contactEmail,
      unitPrice: order.unitPrice,
      totalAmount: order.totalAmount,
      currency: order.currency,
      payment: this.paymentView(order),
      designs: order.designs.map((design) => this.designLinks(design)),
      createdAt: order.createdAt,
    };
  }

  private discardUploadedDesigns(files: Multer.File[]) {
    for (const file of files) {
      unlink(file.path, (error) => {
        if (error) {
          this.logger.warn(
            `Could not discard design file ${file.filename}: ${error.message}`,
          );
        }
      });
    }
  }

  // ==========================================
  // THE ACCOUNT'S OWN WHOLESALE REQUESTS
  // ==========================================

  async myOrders(actor: Actor | undefined) {
    // An undefined userId must fail here rather than reach `where`: Prisma drops
    // undefined filters, so it would silently return every customer's orders.
    if (!actor?.userId) {
      throw new ForbiddenException('Sign in to view your wholesale requests.');
    }

    const orders = await this.prisma.wholesaleOrder.findMany({
      where: { userId: actor.userId },
      include: WHOLESALE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.asCustomerView(order));
  }

  // ==========================================
  // STATUS FOR THE OWNING CUSTOMER
  // ==========================================

  async statusForOwner(reference: string, guest: WholesaleGuestKeyDto, actor?: Actor) {
    const order = await this.findForActor(reference, actor, guest.accessKey);

    return {
      reference: order.reference,
      status: order.status,
      quantity: order.quantity,
      garment: order.garment,
      totalAmount: order.totalAmount,
      currency: order.currency,
      payment: this.paymentView(order),
      createdAt: order.createdAt,
    };
  }

  // ==========================================
  // PAYMENT
  // ==========================================

  async createPaymentOrder(
    reference: string,
    guest: WholesaleGuestKeyDto,
    actor?: Actor,
  ) {
    const order = await this.findForActor(reference, actor, guest.accessKey);

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        `Wholesale ${order.reference} is ${order.status} and cannot be paid again.`,
      );
    }

    if (order.totalAmount <= 0) {
      throw new BadRequestException(
        'Wholesale amount must be greater than zero',
      );
    }

    // A retry after a dropped modal must not open a second Razorpay order.
    if (order.razorpayOrderId) {
      return {
        reference: order.reference,
        razorpayOrderId: order.razorpayOrderId,
        amount: Math.round(order.totalAmount * 100),
        currency: order.currency,
        keyId: this.razorpay.keyId,
      };
    }

    const razorpayOrder = await this.razorpay.createOrder({
      amountInPaise: Math.round(order.totalAmount * 100),
      currency: order.currency,
      receipt: `wholesale_${order.id}`,
      notes: {
        wholesaleOrderId: String(order.id),
        reference: order.reference,
        contactEmail: order.contactEmail,
      },
    });

    await this.prisma.wholesaleOrder.update({
      where: { id: order.id },
      data: { razorpayOrderId: razorpayOrder.razorpayOrderId },
    });

    this.logger.log(
      `Wholesale ${order.reference}: Razorpay order ${razorpayOrder.razorpayOrderId} created`,
    );

    return {
      reference: order.reference,
      ...razorpayOrder,
      keyId: this.razorpay.keyId,
    };
  }

  async verifyPayment(
    reference: string,
    body: {
      accessKey?: string;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
    actor?: Actor,
  ) {
    const order = await this.findForActor(reference, actor, body.accessKey);

    if (!order.razorpayOrderId) {
      throw new BadRequestException('Razorpay order has not been created');
    }

    if (order.razorpayOrderId !== body.razorpayOrderId) {
      throw new BadRequestException('Razorpay order ID does not match');
    }

    if (
      !this.razorpay.verifyPaymentSignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature,
      )
    ) {
      throw new BadRequestException('Invalid payment signature');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.wholesaleOrder.findUnique({
        where: { id: order.id },
      });

      if (!current) {
        throw new NotFoundException('Wholesale order not found.');
      }

      // No stock and no cart to touch: this is a bulk request, not a retail
      // order, so verification only records the payment.
      if (current.status !== 'PENDING') {
        return { alreadyProcessed: true, order: current };
      }

      if (current.razorpayOrderId !== body.razorpayOrderId) {
        throw new BadRequestException('Razorpay order ID does not match');
      }

      const paid = await tx.wholesaleOrder.update({
        where: { id: current.id },
        data: {
          status: 'PAID',
          razorpayPaymentId: body.razorpayPaymentId,
          razorpaySignature: body.razorpaySignature,
          paidAt: new Date(),
        },
      });

      return { alreadyProcessed: false, order: paid };
    });

    this.logger.log(
      `Wholesale ${reference}: payment ${body.razorpayPaymentId} verified`,
    );

    const withRelations = await this.prisma.wholesaleOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: WHOLESALE_INCLUDE,
    });

    return {
      message: updated.alreadyProcessed
        ? 'Payment already processed'
        : 'Payment verified successfully',
      order: this.asCustomerView(withRelations),
    };
  }

  // ==========================================
  // DESIGN DELIVERY
  // ==========================================

  // Reached with a signed, expiring link rather than an Authorization header so
  // that an admin <img> preview and an "open in new tab" both work while the
  // file itself stays outside the statically served directory.
  async getAuthorizedDesign(id: number, exp: number, sig?: string) {
    const design = await this.findDesignOrThrow(id);

    if (!verifyDesignAccess(this.linkSecret, design.id, exp, sig)) {
      throw new ForbiddenException(
        'This design link is not valid or has expired.',
      );
    }

    return design;
  }

  // ==========================================
  // ADMIN
  // ==========================================

  async adminList(query: { search?: string; status?: WholesaleStatusValue }) {
    const where: Prisma.WholesaleOrderWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    const search = query.search?.trim();

    if (search) {
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { garment: { contains: search, mode: 'insensitive' } },
        { contactPhone: { contains: search, mode: 'insensitive' } },
        { razorpayOrderId: { contains: search, mode: 'insensitive' } },
        { razorpayPaymentId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orders = await this.prisma.wholesaleOrder.findMany({
      where,
      include: {
        designs: { select: { id: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return orders.map((order) => ({
      id: order.id,
      reference: order.reference,
      status: order.status,
      quantity: order.quantity,
      garment: order.garment,
      colorway: order.colorway,
      fabric: order.fabric,
      contactName: order.contactName,
      contactEmail: order.contactEmail,
      company: order.company,
      totalAmount: order.totalAmount,
      currency: order.currency,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId,
      paidAt: order.paidAt,
      payment: this.paymentView(order),
      designCount: order.designs.length,
      linkedUser: order.user,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      nextStatuses: this.nextStatuses(order.status),
    }));
  }

  async adminDetail(id: number) {
    const order = await this.prisma.wholesaleOrder.findUnique({
      where: { id },
      include: WHOLESALE_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Wholesale order not found.');
    }

    return this.asAdminView(order);
  }

  async adminUpdateStatus(id: number, status: WholesaleStatusValue) {
    const order = await this.prisma.wholesaleOrder.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Wholesale order not found.');
    }

    if (order.status === status) {
      const withRelations = await this.prisma.wholesaleOrder.findUniqueOrThrow({
        where: { id },
        include: WHOLESALE_INCLUDE,
      });

      return {
        message: `${order.reference} is already ${status}`,
        order: this.asAdminView(withRelations),
      };
    }

    const allowed = this.nextStatuses(order.status);

    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `${order.reference} cannot move from ${order.status} to ${status}`,
      );
    }

    await this.prisma.wholesaleOrder.update({
      where: { id },
      data: { status },
    });

    const withRelations = await this.prisma.wholesaleOrder.findUniqueOrThrow({
      where: { id },
      include: WHOLESALE_INCLUDE,
    });

    this.logger.log(`${order.reference}: status ${order.status} -> ${status}`);

    return {
      message: `${order.reference} is now ${status}`,
      order: this.asAdminView(withRelations),
    };
  }
}

function trimOrNull(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
