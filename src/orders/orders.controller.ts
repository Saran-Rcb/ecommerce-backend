import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}

  // =========================
  // CREATE ORDER
  // =========================

  @Post()
  @UseGuards(JwtAuthGuard)
  createOrder(
    @Req() req: any,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(
      req.user.userId,
      createOrderDto,
    );
  }

  // =========================
  // GET USER ORDERS
  // =========================

  @Get()
  @UseGuards(JwtAuthGuard)
  getOrders(@Req() req: any) {
    return this.ordersService.getOrders(
      req.user.userId,
    );
  }

  // =========================
  // GET ALL ORDERS - ADMIN
  // =========================

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getAllOrdersForAdmin() {
    return this.ordersService.getAllOrdersForAdmin();
  }

  // =========================
  // GET SINGLE ORDER
  // =========================

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getOrder(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrder(
      req.user.userId,
      Number(id),
    );
  }

  // =========================
  // CANCEL USER ORDER
  // =========================

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelOrder(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.ordersService.cancelOrder(
      req.user.userId,
      Number(id),
    );
  }
}