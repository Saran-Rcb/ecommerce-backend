import { Module } from '@nestjs/common';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ShippingModule } from '../shipping/shipping.module';

@Module({
  imports: [PrismaModule, ShippingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayService],
  exports: [RazorpayService],
})
export class PaymentsModule {}