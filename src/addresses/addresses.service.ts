import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // CREATE ADDRESS
  async createAddress(
    userId: number,
    createAddressDto: CreateAddressDto,
  ) {
    return this.prisma.address.create({
      data: {
        userId,
        ...createAddressDto,
      },
    });
  }

  // GET ALL USER ADDRESSES
  async getAddresses(userId: number) {
    return this.prisma.address.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // UPDATE ADDRESS
  async updateAddress(
    userId: number,
    addressId: number,
    updateAddressDto: UpdateAddressDto,
  ) {
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!address) {
      throw new NotFoundException(
        'Address not found',
      );
    }

    return this.prisma.address.update({
      where: {
        id: addressId,
      },
      data: updateAddressDto,
    });
  }

  // DELETE ADDRESS
  async deleteAddress(
    userId: number,
    addressId: number,
  ) {
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!address) {
      throw new NotFoundException(
        'Address not found',
      );
    }

    return this.prisma.address.delete({
      where: {
        id: addressId,
      },
    });
  }
}