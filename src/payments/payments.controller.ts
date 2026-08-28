import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
  ) {}

  // ==========================================
  // CREATE RAZORPAY ORDER
  // ==========================================

  @Post('create-order')
  @UseGuards(JwtAuthGuard)
  createPaymentOrder(@Req() req: any) {
    return this.paymentsService.createPaymentOrder(
      req.user.userId,
      req.body.orderId,
    );
  }

  // ==========================================
  // VERIFY PAYMENT
  // ==========================================

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  verifyPayment(
    @Req() req: any,
    @Body()
    body: {
      orderId: number;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    return this.paymentsService.verifyPayment(
      req.user.userId,
      Number(body.orderId),
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
  }

  // ==========================================
  // GET RAZORPAY PUBLIC KEY
  // ==========================================

  @Get('key')
  @UseGuards(JwtAuthGuard)
  getPublicKey() {
    return this.paymentsService.getPublicKey();
  }

  // ==========================================
  // RAZORPAY WEBHOOK
  //
  // IMPORTANT:
  // No JWT guard here.
  //
  // Razorpay calls this endpoint directly.
  // ==========================================

  @Post('webhook')
  handleWebhook(
    @Req() req: any,
    @Headers('x-razorpay-signature')
    signature: string,
    @Body() body: any,
  ) {
    return this.paymentsService.handleWebhook(
      body,
      signature,
      req.rawBody,
    );
  }
}