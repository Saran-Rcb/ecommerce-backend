import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  getCart(@Req() req: any) {
    return this.cartService.getCart(req.user.userId);
  }

  @Post('items')
  @UseGuards(JwtAuthGuard)
  addItem(
    @Req() req: any,
    @Body() addCartItemDto: AddCartItemDto,
  ) {
    return this.cartService.addItem(
      req.user.userId,
      addCartItemDto,
    );
  }

  @Patch('items/:id')
  @UseGuards(JwtAuthGuard)
  updateItem(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateCartItemDto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(
      req.user.userId,
      Number(id),
      updateCartItemDto,
    );
  }

  @Delete('items/:id')
  @UseGuards(JwtAuthGuard)
  removeItem(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.cartService.removeItem(
      req.user.userId,
      Number(id),
    );
  }
}