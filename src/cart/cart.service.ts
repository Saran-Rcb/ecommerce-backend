import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  // ADD ITEM TO CART
  async addItem(
    userId: number,
    addCartItemDto: AddCartItemDto,
  ) {
    const { productId, quantity } = addCartItemDto;

    // Check product exists
    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Check requested quantity against stock
    if (quantity > product.stock) {
      throw new BadRequestException(
        `Only ${product.stock} items are available`,
      );
    }

    // Find user's cart
    let cart = await this.prisma.cart.findUnique({
      where: {
        userId,
      },
    });

    // Create cart if it doesn't exist
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: {
          userId,
        },
      });
    }

    // Check whether product already exists in cart
    const existingItem = await this.prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    // Product already in cart
    if (existingItem) {
      const newQuantity =
        existingItem.quantity + quantity;

      // Check total quantity against stock
      if (newQuantity > product.stock) {
        throw new BadRequestException(
          `Only ${product.stock} items are available`,
        );
      }

      return this.prisma.cartItem.update({
        where: {
          id: existingItem.id,
        },
        data: {
          quantity: newQuantity,
        },
        include: {
          product: true,
        },
      });
    }

    // Product not yet in cart
    return this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        quantity,
      },
      include: {
        product: true,
      },
    });
  }

  // GET USER CART
  async getCart(userId: number) {
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

    if (!cart) {
      return {
        id: null,
        items: [],
      };
    }

    return cart;
  }

  // UPDATE CART ITEM QUANTITY
  async updateItem(
    userId: number,
    itemId: number,
    updateCartItemDto: UpdateCartItemDto,
  ) {
    const cart = await this.prisma.cart.findUnique({
      where: {
        userId,
      },
    });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    const item = await this.prisma.cartItem.findFirst({
      where: {
        id: itemId,
        cartId: cart.id,
      },
      include: {
        product: true,
      },
    });

    if (!item) {
      throw new NotFoundException(
        'Cart item not found',
      );
    }

    // Check requested quantity against product stock
    if (
      updateCartItemDto.quantity >
      item.product.stock
    ) {
      throw new BadRequestException(
        `Only ${item.product.stock} items are available`,
      );
    }

    return this.prisma.cartItem.update({
      where: {
        id: itemId,
      },
      data: {
        quantity: updateCartItemDto.quantity,
      },
      include: {
        product: true,
      },
    });
  }

  // REMOVE ITEM FROM CART
  async removeItem(
    userId: number,
    itemId: number,
  ) {
    const cart = await this.prisma.cart.findUnique({
      where: {
        userId,
      },
    });

    if (!cart) {
      throw new NotFoundException(
        'Cart not found',
      );
    }

    const item = await this.prisma.cartItem.findFirst({
      where: {
        id: itemId,
        cartId: cart.id,
      },
    });

    if (!item) {
      throw new NotFoundException(
        'Cart item not found',
      );
    }

    return this.prisma.cartItem.delete({
      where: {
        id: itemId,
      },
    });
  }
}