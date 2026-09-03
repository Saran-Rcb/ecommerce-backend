import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { summarizeOrder, summarizePriceLines } from '../pricing/pricing';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  ORDER_STATUSES,
  OrderStatusValue,
} from './dto/update-order-status.dto';
import {
  ALLOWED_TRANSITIONS,
  STOCK_RETURNED_ON_CANCEL,
} from './order-lifecycle';

const ADMIN_ORDER_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  address: true,
  items: {
    include: {
      product: true,
      variant: true,
    },
  },
} satisfies Prisma.OrderInclude;

const CUSTOMER_ORDER_INCLUDE = {
  address: true,
  items: {
    include: {
      product: true,
      variant: true,
    },
  },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private withSummary<T extends { totalAmount: number }>(order: T) {
    return {
      ...order,
      summary: summarizeOrder(order),
    };
  }

  private asAdminView<T extends { status: OrderStatusValue; totalAmount: number }>(
    order: T,
  ) {
    return {
      ...this.withSummary(order),
      nextStatuses: ALLOWED_TRANSITIONS[order.status] ?? [],
    };
  }

  // ==========================================
  // CREATE ORDER
  // ==========================================

  async createOrder(userId: number, createOrderDto: CreateOrderDto) {
    const { addressId } = createOrderDto;

    // Check address belongs to current user
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // Get user's cart
    const cart = await this.prisma.cart.findUnique({
      where: {
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

    // Check cart
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Check current stock
    for (const item of cart.items) {
      if (item.quantity > item.product.stock) {
        throw new BadRequestException(
          `Only ${item.product.stock} items are available for ${item.product.name}`,
        );
      }
    }

    // Backend-authoritative pricing: the payable total, the MRP discount and
    // the shipping charge are all calculated here from catalog prices.
    const summary = summarizePriceLines(
      cart.items.map((item) => ({
        price: item.product.price,
        mrp: item.product.mrp,
        quantity: item.quantity,
      })),
    );

    // Create PENDING order only.
    //
    // IMPORTANT:
    // We DO NOT decrease stock here.
    // We DO NOT clear the cart here.
    //
    // Those operations happen only after
    // successful Razorpay payment verification.
    const order = await this.prisma.order.create({
      data: {
        userId,

        // Save the exact address selected
        // during checkout.
        addressId,

        status: 'PENDING',
        totalAmount: summary.totalAmount,
        discountAmount: summary.discountAmount,
        shippingCharge: summary.shippingCharge,

        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,

            // Purchased-price snapshot: later catalog price changes
            // must never rewrite this order.
            price: item.product.price,
            color: item.color,
            size: item.size,
            variantId: item.variantId,
          })),
        },
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
      message: 'Order created successfully',
      order,
      summary,
    };
  }

  // ==========================================
  // GET USER ORDERS
  // ==========================================

  async getOrders(userId: number) {
    const orders = await this.prisma.order.findMany({
      where: {
        userId,
      },

      orderBy: {
        createdAt: 'desc',
      },

      include: CUSTOMER_ORDER_INCLUDE,
    });

    return orders.map((order) => this.withSummary(order));
  }

  // ==========================================
  // GET SINGLE USER ORDER
  // ==========================================

  async getOrder(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },

      include: CUSTOMER_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.withSummary(order);
  }

  // ==========================================
  // CANCEL USER ORDER
  // ==========================================

  async cancelOrder(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },

      include: {
        items: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Only pending orders can be cancelled
    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending orders can be cancelled',
      );
    }

    // Since stock is no longer decreased
    // when the order is created, we do NOT
    // restore stock when cancelling a PENDING
    // order.
    const cancelledOrder = await this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        status: 'CANCELLED',
      },

      include: CUSTOMER_ORDER_INCLUDE,
    });

    return {
      message: 'Order cancelled successfully',
      order: this.withSummary(cancelledOrder),
    };
  }

  // ==========================================
  // GET ALL ORDERS - ADMIN ONLY
  // ==========================================

  async getAllOrdersForAdmin(filters: {
    search?: string;
    status?: string;
  }) {
    const search = filters.search?.trim();
    const status = filters.status?.trim() as
      | OrderStatusValue
      | undefined;

    if (status && !ORDER_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Unknown order status "${status}"`,
      );
    }

    const where: Prisma.OrderWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      const orderNumber = Number(search);

      where.OR = [
        {
          user: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          user: {
            email: { contains: search, mode: 'insensitive' },
          },
        },
        {
          address: {
            fullName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          items: {
            some: {
              product: {
                name: { contains: search, mode: 'insensitive' },
              },
            },
          },
        },
      ];

      if (Number.isInteger(orderNumber) && orderNumber > 0) {
        where.OR.push({ id: orderNumber });
      }
    }

    const orders = await this.prisma.order.findMany({
      where,

      orderBy: {
        createdAt: 'desc',
      },

      include: ADMIN_ORDER_INCLUDE,
    });

    return orders.map((order) => this.asAdminView(order));
  }

  // ==========================================
  // CHANGE ORDER STATUS - ADMIN ONLY
  // ==========================================

  async updateOrderStatus(orderId: number, status: OrderStatusValue) {
    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },

      include: ADMIN_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === status) {
      return {
        message: `Order #${orderId} is already ${status}`,
        order: this.asAdminView(order),
      };
    }

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];

    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Order #${orderId} cannot move from ${order.status} to ${status}`,
      );
    }

    const returnStock =
      status === 'CANCELLED' &&
      STOCK_RETURNED_ON_CANCEL.includes(order.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (returnStock) {
        for (const item of order.items) {
          await tx.product.update({
            where: {
              id: item.productId,
            },

            data: {
              stock: {
                increment: item.quantity,
              },
            },
          });
        }
      }

      return tx.order.update({
        where: {
          id: orderId,
        },

        data: {
          status,
        },

        include: ADMIN_ORDER_INCLUDE,
      });
    });

    return {
      message: `Order #${orderId} is now ${status}`,
      order: this.asAdminView(updated),
    };
  }
}
