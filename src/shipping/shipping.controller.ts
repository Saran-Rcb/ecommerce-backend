import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';

import { ShippingService } from './shipping.service';
import { AssignCourierDto } from './dto/assign-courier.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/**
 * Shipping is carrier work, so every route here is admin-only. Reads of the
 * stored record need no Shiprocket account; the live operations call the
 * carrier and report a configuration error when one is missing.
 */
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  // ==========================================
  // CONFIGURATION STATE - NO SECRETS RETURNED
  // ==========================================

  @Get('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getConfiguration() {
    return this.shippingService.configuration();
  }

  // ==========================================
  // TEST SHIPROCKET LOGIN
  // ==========================================

  @Post('test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  testConnection() {
    return this.shippingService.testConnection();
  }

  // ==========================================
  // STORED SHIPPING RECORD (WORKS OFFLINE)
  // ==========================================

  @Get('orders/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getOrderShipping(@Param('orderId') orderId: string) {
    return this.shippingService.getOrderShipping(Number(orderId));
  }

  // ==========================================
  // CREATE SHIPMENT FOR A PAID ORDER
  // ==========================================

  @Post('orders/:orderId/shipment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createShipment(@Param('orderId') orderId: string) {
    return this.shippingService.createShipmentForOrder(Number(orderId));
  }

  // ==========================================
  // GET AVAILABLE COURIERS
  // ==========================================

  @Get('orders/:orderId/couriers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getAvailableCouriers(@Param('orderId') orderId: string) {
    return this.shippingService.getAvailableCouriers(Number(orderId));
  }

  // ==========================================
  // ASSIGN COURIER / AWB
  // ==========================================

  @Post('orders/:orderId/assign-courier')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  assignCourier(
    @Param('orderId') orderId: string,
    @Body() assignCourierDto: AssignCourierDto,
  ) {
    return this.shippingService.assignCourier(
      Number(orderId),
      assignCourierDto.courierId,
    );
  }

  // ==========================================
  // PULL CARRIER STATUS
  // ==========================================

  @Post('orders/:orderId/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  syncShippingStatus(@Param('orderId') orderId: string) {
    return this.shippingService.syncShippingStatus(Number(orderId));
  }

  // ==========================================
  // CARRIER TRACKING EVENTS
  // ==========================================

  @Get('orders/:orderId/track')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  trackShipment(@Param('orderId') orderId: string) {
    return this.shippingService.trackShipment(Number(orderId));
  }
}
