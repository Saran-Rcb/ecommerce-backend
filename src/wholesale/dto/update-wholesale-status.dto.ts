import { IsIn } from 'class-validator';

import { ORDER_STATUSES } from '../../orders/dto/update-order-status.dto';

// Wholesale uses the same seven status names as retail, which is why
// orders/order-lifecycle can govern both machines without a second copy of the
// rules. Prisma still types this column with its own WholesaleOrderStatus enum,
// so a value outside the seven fails to compile.
export type WholesaleStatusValue = (typeof ORDER_STATUSES)[number];

export class UpdateWholesaleStatusDto {
  @IsIn(ORDER_STATUSES)
  status: WholesaleStatusValue;
}
