import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// The configurator has no login gate, so a guest identifies the submission they
// are paying for with the accessKey the create response handed back. A
// signed-in customer needs nothing extra — ownership comes from the JWT.
export class WholesaleGuestKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accessKey?: string;
}

export class VerifyWholesalePaymentDto extends WholesaleGuestKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  razorpayOrderId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  razorpayPaymentId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  razorpaySignature: string;
}
