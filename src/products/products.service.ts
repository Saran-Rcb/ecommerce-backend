import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllProducts() {
    return this.prisma.product.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getProductById(id: number) {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async createProduct(createProductDto: CreateProductDto) {
    return this.prisma.product.create({
      data: createProductDto,
    });
  }

  async updateProduct(
    id: number,
    updateProductDto: UpdateProductDto,
  ) {
    return this.prisma.product.update({
      where: {
        id,
      },
      data: updateProductDto,
    });
  }

  async deleteProduct(id: number) {
    return this.prisma.product.delete({
      where: {
        id,
      },
    });
  }
}