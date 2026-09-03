import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Text fields arrive through multipart, so everything but the design files is
// a string on the wire. quantity is coerced before it can reach the calculator.
export class CreateWholesaleOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  garment: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fabric: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  colorway: string;

  // Multer collects repeated `sizes` fields as an array; a comma-separated
  // single field is accepted too so the shape is never ambiguous.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(12, { each: true })
  sizes: string[];

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(50)
  quantity: number;

  @IsEmail()
  @MaxLength(160)
  contactEmail: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
