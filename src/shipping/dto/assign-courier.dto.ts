import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignCourierDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  courierId: number;
}
