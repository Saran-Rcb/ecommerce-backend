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

import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
  ) {}

  // Get all products
  @Get()
  @UseGuards(JwtAuthGuard)
  getProducts() {
    return this.productsService.getAllProducts();
  }

  // Get one product by ID
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getProductById(@Param('id') id: string) {
    return this.productsService.getProductById(Number(id));
  }

  // Get current logged-in user
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(@Req() req: any) {
    return req.user;
  }

  // Create product - ADMIN only
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createProduct(@Body() createProductDto: CreateProductDto) {
    return this.productsService.createProduct(createProductDto);
  }

  // Update product - ADMIN only
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(
      Number(id),
      updateProductDto,
    );
  }

  // Delete product - ADMIN only
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteProduct(@Param('id') id: string) {
    return this.productsService.deleteProduct(Number(id));
  }
}