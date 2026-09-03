import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  async getCategories() {
    const products = await this.prisma.product.findMany({
      select: {
        collection: true,
      },
      where: {
        collection: { not: null },
      },
    });

    const categories = new Set<string>();
    products.forEach((p) => {
      if (p.collection) categories.add(p.collection);
    });

    return Array.from(categories).sort();
  }

  async getProductBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: {
        slug,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with slug "${slug}" not found`);
    }

    return product;
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
    // Ensure price is positive
    if (createProductDto.price < 0) {
      createProductDto.price = 0;
    }
    // Ensure MRP is positive if provided
    if (
      createProductDto.mrp !== undefined &&
      createProductDto.mrp < 0
    ) {
      createProductDto.mrp = 0;
    }
    // Ensure selling price does not exceed MRP if MRP is set
    if (
      createProductDto.mrp !== undefined &&
      createProductDto.mrp > 0 &&
      createProductDto.price > createProductDto.mrp
    ) {
      createProductDto.price = createProductDto.mrp;
    }

    return this.prisma.product.create({
      data: createProductDto,
    });
  }

  async updateProduct(
    id: number,
    updateProductDto: UpdateProductDto,
  ) {
    // Ensure price is positive if provided
    if (updateProductDto.price !== undefined && updateProductDto.price < 0) {
      updateProductDto.price = 0;
    }
    // Ensure MRP is positive if provided
    if (updateProductDto.mrp !== undefined && updateProductDto.mrp < 0) {
      updateProductDto.mrp = 0;
    }
    // Ensure selling price does not exceed MRP if MRP is set
    if (
      updateProductDto.mrp !== undefined &&
      updateProductDto.mrp > 0 &&
      updateProductDto.price !== undefined &&
      updateProductDto.price > updateProductDto.mrp
    ) {
      updateProductDto.price = updateProductDto.mrp;
    }

    return this.prisma.product.update({
      where: {
        id,
      },
      data: updateProductDto,
    });
  }

  async deleteProduct(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        _count: {
          select: { orderItems: true, cartItems: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    const { orderItems, cartItems } = product._count;
    if (orderItems > 0) {
      throw new ConflictException(
        `"${product.name}" appears in ${orderItems} order line item(s), so it cannot be deleted. Deleting it would erase order history.`,
      );
    }
    if (cartItems > 0) {
      throw new ConflictException(
        `"${product.name}" is in ${cartItems} active cart(s), so it cannot be deleted yet.`,
      );
    }

    try {
      return await this.prisma.product.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2003') {
        throw new ConflictException(
          `"${product.name}" is still referenced by existing records and cannot be deleted.`,
        );
      }
      throw error;
    }
  }
}