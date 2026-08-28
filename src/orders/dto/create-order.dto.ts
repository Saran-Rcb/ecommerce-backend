import { IsInt, Min } from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  @Min(1)
  addressId: number;
}