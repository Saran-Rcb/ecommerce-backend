import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AddressesService } from './addresses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Controller('addresses')
export class AddressesController {
  constructor(
    private readonly addressesService: AddressesService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  createAddress(
    @Req() req: any,
    @Body() createAddressDto: CreateAddressDto,
  ) {
    return this.addressesService.createAddress(
      req.user.userId,
      createAddressDto,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  getAddresses(@Req() req: any) {
    return this.addressesService.getAddresses(
      req.user.userId,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  updateAddress(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateAddressDto: UpdateAddressDto,
  ) {
    return this.addressesService.updateAddress(
      req.user.userId,
      Number(id),
      updateAddressDto,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  deleteAddress(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.addressesService.deleteAddress(
      req.user.userId,
      Number(id),
    );
  }
}