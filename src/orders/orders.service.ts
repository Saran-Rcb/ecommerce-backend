import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // CREATE ORDER
  // ==========================================

  async createOrder(
    userId: number,
    createOrderDto: CreateOrderDto,
  ) {
    const { addressId } = createOrderDto;

    // Check address belongs to current user
    const address =
      await this.prisma.address.findFirst({
        where: {
          id: addressId,
          userId,
        },
      });

    if (!address) {
      throw new NotFoundException(
        'Address not found',
      );
    }

    // Get user's cart
    const cart =
      await this.prisma.cart.findUnique({
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
      throw new BadRequestException(
        'Cart is empty',
      );
    }

    // Check current stock
    for (const item of cart.items) {
      if (
        item.quantity >
        item.product.stock
      ) {
        throw new BadRequestException(
          `Only ${item.product.stock} items are available for ${item.product.name}`,
        );
      }
    }

    // Calculate total
    const totalAmount =
      cart.items.reduce(
        (total, item) => {
          return (
            total +
            item.product.price *
              item.quantity
          );
        },
        0,
      );

    // Create PENDING order only.
    //
    // IMPORTANT:
    // We DO NOT decrease stock here.
    // We DO NOT clear the cart here.
    //
    // Those operations happen only after
    // successful Razorpay payment verification.
    const order =
      await this.prisma.order.create({
        data: {
          userId,

          // Save the exact address selected
          // during checkout.
          addressId,

          status: 'PENDING',
          totalAmount,

          items: {
            create: cart.items.map(
              (item) => ({
                productId:
                  item.productId,
                quantity:
                  item.quantity,
                price:
                  item.product.price,
              }),
            ),
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
      message:
        'Order created successfully',
      order,
    };
  }

  // ==========================================
  // GET USER ORDERS
  // ==========================================

  async getOrders(userId: number) {
    return this.prisma.order.findMany({
      where: {
        userId,
      },

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        address: true,

        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  // ==========================================
  // GET SINGLE USER ORDER
  // ==========================================

  async getOrder(
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
          address: true,

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

    return order;
  }

  // ==========================================
  // CANCEL USER ORDER
  // ==========================================

  async cancelOrder(
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
    const cancelledOrder =
      await this.prisma.order.update({
        where: {
          id: orderId,
        },

        data: {
          status: 'CANCELLED',
        },

        include: {
          address: true,

          items: {
            include: {
              product: true,
            },
          },
        },
      });

    return {
      message:
        'Order cancelled successfully',
      order: cancelledOrder,
    };
  }

  // ==========================================
  // GET ALL ORDERS - ADMIN ONLY
  // ==========================================

  async getAllOrdersForAdmin() {
    return this.prisma.order.findMany({
      orderBy: {
        createdAt: 'desc',
      },

      include: {
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
          },
        },
      },
    });
  }
}