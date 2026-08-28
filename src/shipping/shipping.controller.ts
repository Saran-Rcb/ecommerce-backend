import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ShippingService } from './shipping.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly shippingService: ShippingService,
  ) {}

  // ==========================================
  // TEST SHIPROCKET LOGIN
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('test')
  async testShiprocketLogin() {
    return this.shippingService.loginToShiprocket();
  }

  // ==========================================
  // CREATE SHIPMENT FOR PAID ORDER
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('orders/:orderId/create')
  async createShipmentForOrder(
    @Param('orderId') orderId: string,
  ) {
    return this.shippingService.createShipmentForOrder(
      Number(orderId),
    );
  }

  // ==========================================
  // GET SHIPPING DETAILS
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('orders/:orderId')
  async getShippingDetails(
    @Param('orderId') orderId: string,
  ) {
    return this.shippingService.getShippingDetails(
      Number(orderId),
    );
  }

  // ==========================================
  // GET AVAILABLE COURIERS
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('couriers')
  async getAvailableCouriers(
    @Query('orderId') orderId: string,
    @Query('shipmentId') shipmentId: string,
  ) {
    return this.shippingService.getAvailableCouriers(
      Number(orderId),
      Number(shipmentId),
    );
  }

  // ==========================================
  // ASSIGN COURIER / AWB
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('assign-courier')
  async assignCourier(
    @Query('shipmentId') shipmentId: string,
    @Query('courierId') courierId: string,
  ) {
    return this.shippingService.assignCourier(
      Number(shipmentId),
      Number(courierId),
    );
  }
}