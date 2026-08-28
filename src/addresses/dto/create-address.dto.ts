import {
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{10}$/, {
    message: 'Phone number must be exactly 10 digits',
  })
  phone: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{6}$/, {
    message: 'Postal code must be exactly 6 digits',
  })
  postalCode: string;
}