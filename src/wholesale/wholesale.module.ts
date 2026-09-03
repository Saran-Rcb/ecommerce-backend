import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/payments.module';
import { WholesaleController } from './wholesale.controller';
import { WholesaleService } from './wholesale.service';

@Module({
  imports: [PaymentsModule],
  controllers: [WholesaleController],
  providers: [WholesaleService],
})
export class WholesaleModule {}
