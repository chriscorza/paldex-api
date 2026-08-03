import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  Req,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { PrismaService } from '../prisma.service';
import { ProductCostsService } from './product-costs.service';
import {
  CreateProductCostDto,
  UpdateProductCostDto,
  BulkProductCostDto,
  FilterProductCostsDto,
} from './dto/product-cost.dto';
import {
  CreateProductCategoryOverrideDto,
  UpdateProductCategoryOverrideDto,
  FilterProductCategoryOverridesDto,
} from './dto/category-override.dto';

@ApiTags('Product Costs')
@ApiBearerAuth()
@Controller()
export class ProductCostsController {
  constructor(
    private readonly service: ProductCostsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('product-costs')
  @RequirePermissions('product_cost:read')
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() filters: FilterProductCostsDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findAll(ctx, filters);
  }

  @Get('product-costs/missing')
  @RequirePermissions('product_cost:read')
  getMissing(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query('start_date') startDate: string,
    @Query('end_date') endDate: string,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.getMissing(ctx, startDate, endDate);
  }

  @Get('product-costs/:id')
  @RequirePermissions('product_cost:read')
  findOne(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findOne(ctx, id);
  }

  @Post('product-costs')
  @RequirePermissions('product_cost:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreateProductCostDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.create(ctx, dto);
  }

  @Post('product-costs/bulk')
  @RequirePermissions('product_cost:create')
  bulkCreate(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: BulkProductCostDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.bulkCreate(ctx, dto);
  }

  @Patch('product-costs/:id')
  @RequirePermissions('product_cost:update')
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductCostDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.update(ctx, id, dto);
  }

  @Delete('product-costs/:id')
  @RequirePermissions('product_cost:delete')
  remove(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.remove(ctx, id);
  }

  @Get('product-category-overrides')
  @RequirePermissions('product_category_override:read')
  async listOverrides(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() filters: FilterProductCategoryOverridesDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    const where: any = { ...buildOwnerFilter(ctx) };
    const page = filters.page || 1;
    const limit = filters.limit || 100;
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.productCategoryOverride.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.productCategoryOverride.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  @Post('product-category-overrides')
  @RequirePermissions('product_category_override:create')
  async createOverride(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreateProductCategoryOverrideDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    const existing = await this.prisma.productCategoryOverride.findFirst({
      where: {
        user_id: ctx.userId,
        shopify_product_id: dto.shopify_product_id,
      },
    });
    if (existing)
      throw new ConflictException('Override already exists for this product');
    return this.prisma.productCategoryOverride.create({
      data: {
        shopify_product_id: dto.shopify_product_id,
        category_name: dto.category_name,
        user_id: ctx.userId,
      },
    });
  }

  @Patch('product-category-overrides/:id')
  @RequirePermissions('product_category_override:update')
  async updateOverride(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductCategoryOverrideDto,
  ) {
    const existing = await this.prisma.productCategoryOverride.findFirst({
      where: { id, user_id: user.id },
    });
    if (!existing) throw new NotFoundException('Override not found');
    return this.prisma.productCategoryOverride.update({
      where: { id },
      data: { category_name: dto.category_name },
    });
  }

  @Delete('product-category-overrides/:id')
  @RequirePermissions('product_category_override:delete')
  async deleteOverride(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const existing = await this.prisma.productCategoryOverride.findFirst({
      where: { id, user_id: user.id },
    });
    if (!existing) throw new NotFoundException('Override not found');
    await this.prisma.productCategoryOverride.delete({ where: { id } });
  }
}
