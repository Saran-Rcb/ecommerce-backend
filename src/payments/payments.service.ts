import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import Razorpay from 'razorpay';

import * as crypto from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { ShippingService } from '../shipping/shipping.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private readonly razorpay: Razorpay;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly shippingService: ShippingService,
  ) {
    const keyId =
      this.configService.get<string>(
        'RAZORPAY_KEY_ID',
      );

    const keySecret =
      this.configService.get<string>(
        'RAZORPAY_KEY_SECRET',
      );

    if (!keyId || !keySecret) {
      throw new Error(
        'Razorpay credentials are not configured',
      );
    }

    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  // ==========================================
  // CREATE RAZORPAY ORDER
  // ==========================================

  async createPaymentOrder(
    userId: number,
    orderId: number,
  ) {
    const order =
      await this.prisma.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
        include: {
          items: true,
        },
      });

    if (!order) {
      throw new NotFoundException(
        'Order not found',
      );
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending orders can be paid',
      );
    }

    if (order.totalAmount <= 0) {
      throw new BadRequestException(
        'Order amount must be greater than zero',
      );
    }

    // Reuse an existing Razorpay order
    if (order.razorpayOrderId) {
      return {
        orderId: order.id,
        razorpayOrderId:
          order.razorpayOrderId,
        amount: Math.round(
          order.totalAmount * 100,
        ),
        currency: 'INR',
        keyId:
          this.configService.get<string>(
            'RAZORPAY_KEY_ID',
          ),
      };
    }

    // Create Razorpay order
    const razorpayOrder =
      await this.razorpay.orders.create({
        amount: Math.round(
          order.totalAmount * 100,
        ),
        currency: 'INR',
        receipt: `order_${order.id}`,
        notes: {
          userId: String(userId),
          orderId: String(order.id),
        },
      });

    // Save Razorpay order ID
    await this.prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        razorpayOrderId:
          razorpayOrder.id,
      },
    });

    return {
      orderId: order.id,
      razorpayOrderId:
        razorpayOrder.id,
      amount:
        razorpayOrder.amount,
      currency:
        razorpayOrder.currency,
      keyId:
        this.configService.get<string>(
          'RAZORPAY_KEY_ID',
        ),
    };
  }

  // ==========================================
  // VERIFY PAYMENT
  // ==========================================

  async verifyPayment(
    userId: number,
    orderId: number,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ) {
    // Check order ownership
    const order =
      await this.prisma.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

    if (!order) {
      throw new NotFoundException(
        'Order not found',
      );
    }

    // Razorpay order must exist
    if (!order.razorpayOrderId) {
      throw new BadRequestException(
        'Razorpay order has not been created',
      );
    }

    // Verify Razorpay order ID
    if (
      order.razorpayOrderId !==
      razorpayOrderId
    ) {
      throw new BadRequestException(
        'Razorpay order ID does not match',
      );
    }

    // Get Razorpay secret
    const keySecret =
      this.configService.get<string>(
        'RAZORPAY_KEY_SECRET',
      );

    if (!keySecret) {
      throw new BadRequestException(
        'Razorpay secret is not configured',
      );
    }

    // ==========================================
    // VERIFY RAZORPAY PAYMENT SIGNATURE
    // ==========================================

    const generatedSignature =
      crypto
        .createHmac(
          'sha256',
          keySecret,
        )
        .update(
          `${razorpayOrderId}|${razorpayPaymentId}`,
        )
        .digest('hex');

    if (
      generatedSignature !==
      razorpaySignature
    ) {
      throw new BadRequestException(
        'Invalid payment signature',
      );
    }

    // ==========================================
    // FINALIZE PAYMENT
    // ==========================================

    const result =
      await this.prisma.$transaction(
        async (tx) => {
          // Re-read order inside transaction
          const currentOrder =
            await tx.order.findUnique({
              where: {
                id: orderId,
              },
              include: {
                items: {
                  include: {
                    product: true,
                  },
                },
              },
            });

          if (!currentOrder) {
            throw new NotFoundException(
              'Order not found',
            );
          }

          // ========================================
          // IMPORTANT:
          // WEBHOOK MAY HAVE PROCESSED THE PAYMENT
          // ========================================

          if (
            currentOrder.status !==
            'PENDING'
          ) {
            return {
              alreadyProcessed: true,

              message:
                'Payment already processed',

              order: currentOrder,
            };
          }

          // Verify Razorpay order again
          if (
            currentOrder.razorpayOrderId !==
            razorpayOrderId
          ) {
            throw new BadRequestException(
              'Razorpay order ID does not match',
            );
          }

          // ========================================
          // CHECK STOCK
          // ========================================

          for (const item of currentOrder.items) {
            const product =
              await tx.product.findUnique({
                where: {
                  id: item.productId,
                },
              });

            if (!product) {
              throw new NotFoundException(
                `Product ${item.productId} not found`,
              );
            }

            if (
              item.quantity >
              product.stock
            ) {
              throw new BadRequestException(
                `Only ${product.stock} items are available for ${product.name}`,
              );
            }
          }

          // ========================================
          // DECREASE STOCK
          // ========================================

          for (const item of currentOrder.items) {
            await tx.product.update({
              where: {
                id: item.productId,
              },
              data: {
                stock: {
                  decrement:
                    item.quantity,
                },
              },
            });
          }

          // ========================================
          // CLEAR CART
          // ========================================

          const cart =
            await tx.cart.findUnique({
              where: {
                userId:
                  currentOrder.userId,
              },
            });

          if (cart) {
            await tx.cartItem.deleteMany({
              where: {
                cartId: cart.id,
              },
            });
          }

          // ========================================
          // MARK ORDER AS PAID
          // ========================================

          const paidOrder =
            await tx.order.update({
              where: {
                id: currentOrder.id,
              },
              data: {
                status: 'PAID',

                razorpayPaymentId:
                  razorpayPaymentId,

                razorpaySignature:
                  razorpaySignature,
              },
              include: {
                items: {
                  include: {
                    product: true,
                  },
                },
              },
            });

          return {
            alreadyProcessed: false,

            message:
              'Payment verified successfully',

            order: paidOrder,
          };
        },
      );

    // ==========================================
    // OPTIONAL SHIPMENT HANDOFF
    // ==========================================

    // Shiprocket is opt-in per deployment. A payment must never create a
    // carrier shipment the operator has not enabled, and a shipping failure
    // must never undo a verified payment.

    if (
      !result.alreadyProcessed &&
      result.order.status === 'PAID'
    ) {
      const shipment =
        await this.shippingService.autoCreateShipment(
          result.order.id,
        );

      if (shipment.created) {
        this.logger.log(
          `Order ${result.order.id}: ${shipment.message}`,
        );
      } else {
        this.logger.log(
          `Order ${result.order.id}: no shipment created - ${shipment.reason}`,
        );
      }
    }

    return result;
  }

  // ==========================================
  // RAZORPAY WEBHOOK
  // ==========================================

  async handleWebhook(
    body: any,
    signature: string,
    rawBody: Buffer,
  ) {
    const webhookSecret =
      this.configService.get<string>(
        'RAZORPAY_WEBHOOK_SECRET',
      );

    if (!webhookSecret) {
      throw new BadRequestException(
        'Razorpay webhook secret is not configured',
      );
    }

    if (!signature) {
      throw new BadRequestException(
        'Missing Razorpay webhook signature',
      );
    }

    if (!rawBody) {
      throw new BadRequestException(
        'Raw webhook body is missing',
      );
    }

    // ==========================================
    // VERIFY WEBHOOK SIGNATURE
    // ==========================================

    const expectedSignature =
      crypto
        .createHmac(
          'sha256',
          webhookSecret,
        )
        .update(rawBody)
        .digest('hex');

    if (
      expectedSignature !==
      signature
    ) {
      throw new BadRequestException(
        'Invalid Razorpay webhook signature',
      );
    }

    const event = body.event;

    // ==========================================
    // PAYMENT CAPTURED
    // ==========================================

    if (
      event === 'payment.captured'
    ) {
      const payment =
        body.payload?.payment?.entity;

      const razorpayOrderId =
        payment?.order_id;

      const razorpayPaymentId =
        payment?.id;

      if (
        !razorpayOrderId ||
        !razorpayPaymentId
      ) {
        return {
          message:
            'Webhook received but payment information is incomplete',
        };
      }

      // Find order
      const order =
        await this.prisma.order.findFirst({
          where: {
            razorpayOrderId,
          },
          include: {
            items: {
              include: {
                product: true,
              },
            },
          },
        });

      if (!order) {
        return {
          message:
            'Webhook received but order was not found',
        };
      }

      // ========================================
      // IDEMPOTENCY
      // ========================================

      if (order.status === 'PAID') {
        return {
          message:
            'Order already marked as paid',
        };
      }

      // ========================================
      // PROCESS WEBHOOK
      // ========================================

      await this.prisma.$transaction(
        async (tx) => {
          const currentOrder =
            await tx.order.findUnique({
              where: {
                id: order.id,
              },
              include: {
                items: {
                  include: {
                    product: true,
                  },
                },
              },
            });

          if (!currentOrder) {
            throw new NotFoundException(
              'Order not found',
            );
          }

          // Another request already processed
          // the payment.
          if (
            currentOrder.status !==
            'PENDING'
          ) {
            return;
          }

          // Verify Razorpay order ID
          if (
            currentOrder.razorpayOrderId !==
            razorpayOrderId
          ) {
            throw new BadRequestException(
              'Razorpay order ID does not match',
            );
          }

          // ======================================
          // CHECK STOCK
          // ======================================

          for (const item of currentOrder.items) {
            const product =
              await tx.product.findUnique({
                where: {
                  id: item.productId,
                },
              });

            if (!product) {
              throw new NotFoundException(
                `Product ${item.productId} not found`,
              );
            }

            if (
              item.quantity >
              product.stock
            ) {
              throw new BadRequestException(
                `Insufficient stock for ${product.name}`,
              );
            }
          }

          // ======================================
          // DECREASE STOCK
          // ======================================

          for (const item of currentOrder.items) {
            await tx.product.update({
              where: {
                id: item.productId,
              },
              data: {
                stock: {
                  decrement:
                    item.quantity,
                },
              },
            });
          }

          // ======================================
          // CLEAR CART
          // ======================================

          const cart =
            await tx.cart.findUnique({
              where: {
                userId:
                  currentOrder.userId,
              },
            });

          if (cart) {
            await tx.cartItem.deleteMany({
              where: {
                cartId: cart.id,
              },
            });
          }

          // ======================================
          // MARK ORDER AS PAID
          // ======================================

          await tx.order.update({
            where: {
              id: currentOrder.id,
            },
            data: {
              status: 'PAID',

              razorpayPaymentId:
                razorpayPaymentId,
            },
          });
        },
      );

      return {
        message:
          'Payment webhook processed successfully',
      };
    }

    // ==========================================
    // OTHER WEBHOOK EVENTS
    // ==========================================

    return {
      message:
        'Webhook received successfully',
    };
  }

  // ==========================================
  // GET RAZORPAY PUBLIC KEY
  // ==========================================

  getPublicKey() {
    return {
      keyId:
        this.configService.get<string>(
          'RAZORPAY_KEY_ID',
        ),
    };
  }
}