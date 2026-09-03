import { Module } from '@nestjs/common';

import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShiprocketClient } from './shiprocket.client';

@Module({
  controllers: [ShippingController],
  providers: [ShiprocketClient, ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
