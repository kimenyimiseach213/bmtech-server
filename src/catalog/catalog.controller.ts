import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ValidateCartDto } from '../common/dto';
import { CatalogService } from './catalog.service';

@ApiTags('storefront')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products') products(@Query('status') status?: string) { return this.catalog.products(status); }
  @Get('products/:slug') product(@Param('slug') slug: string) { return this.catalog.product(slug); }
  @Get('categories') categories(@Query('status') status?: string) { return this.catalog.categories(status); }
  @Post('cart/validate') validateCart(@Body() body: ValidateCartDto) { return this.catalog.validateCart(body.items); }
  @Get('settings/public') settings() { return this.catalog.publicSettings(); }
}
