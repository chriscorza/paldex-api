import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CreateProductCostDto,
  UpdateProductCostDto,
  BulkProductCostDto,
  FilterProductCostsDto,
} from './dto/product-cost.dto';
import {
  ProductCostEntity,
  PRODUCT_COST_SELECT,
} from './entities/product-cost.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';

@Injectable()
export class ProductCostsService {
  constructor(private prisma: PrismaService) {}

  async findAll(ctx: OwnershipContext, filters: FilterProductCostsDto) {
    const where: any = { ...buildOwnerFilter(ctx) };
    if (filters.sku) where.sku = filters.sku;
    if (filters.shopify_variant_id)
      where.shopify_variant_id = filters.shopify_variant_id;

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.productCost.findMany({
        where,
        select: PRODUCT_COST_SELECT,
        skip,
        take: limit,
        orderBy: { effective_from: 'desc' },
      }),
      this.prisma.productCost.count({ where }),
    ]);

    return {
      data: data.map((c) => new ProductCostEntity(c)),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const cost = await this.prisma.productCost.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      select: PRODUCT_COST_SELECT,
    });
    if (!cost) throw new NotFoundException('Product cost not found');
    return new ProductCostEntity(cost);
  }

  async create(ctx: OwnershipContext, dto: CreateProductCostDto) {
    if (!dto.shopify_variant_id && !dto.sku) {
      throw new BadRequestException(
        'At least one of shopify_variant_id or sku is required',
      );
    }

    const cost = await this.prisma.productCost.create({
      data: {
        shopify_variant_id: dto.shopify_variant_id ?? null,
        sku: dto.sku ?? null,
        unit_cost: dto.unit_cost,
        effective_from: dto.effective_from
          ? new Date(dto.effective_from)
          : new Date(),
        source: dto.source ?? 'MANUAL',
        notes: dto.notes ?? null,
        user_id: ctx.userId,
      },
      select: PRODUCT_COST_SELECT,
    });
    return new ProductCostEntity(cost);
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateProductCostDto) {
    const existing = await this.prisma.productCost.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Product cost not found');

    const updateData: any = {};
    if (dto.unit_cost !== undefined) updateData.unit_cost = dto.unit_cost;
    if (dto.effective_from !== undefined)
      updateData.effective_from = new Date(dto.effective_from);
    if (dto.source !== undefined) updateData.source = dto.source;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const cost = await this.prisma.productCost.update({
      where: { id },
      data: updateData,
      select: PRODUCT_COST_SELECT,
    });
    return new ProductCostEntity(cost);
  }

  async remove(ctx: OwnershipContext, id: number) {
    const existing = await this.prisma.productCost.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Product cost not found');
    await this.prisma.productCost.delete({ where: { id } });
  }

  async bulkCreate(ctx: OwnershipContext, dto: BulkProductCostDto) {
    const errors: { index: number; reason: string }[] = [];

    for (let i = 0; i < dto.entries.length; i++) {
      const entry = dto.entries[i];
      if (!entry.shopify_variant_id && !entry.sku) {
        errors.push({
          index: i,
          reason: 'At least one of shopify_variant_id or sku is required',
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }

    let created = 0;
    let updated = 0;

    for (const entry of dto.entries) {
      const where: any = { user_id: ctx.userId };
      if (entry.shopify_variant_id)
        where.shopify_variant_id = entry.shopify_variant_id;
      else if (entry.sku) where.sku = entry.sku;

      const existing = await this.prisma.productCost.findFirst({ where });

      const effectiveDate = entry.effective_from
        ? new Date(entry.effective_from)
        : new Date();

      if (existing) {
        await this.prisma.productCost.update({
          where: { id: existing.id },
          data: {
            unit_cost: entry.unit_cost,
            effective_from: effectiveDate,
            source: entry.source ?? 'MANUAL',
            notes: entry.notes ?? null,
          },
        });
        updated++;
      } else {
        await this.prisma.productCost.create({
          data: {
            shopify_variant_id: entry.shopify_variant_id ?? null,
            sku: entry.sku ?? null,
            unit_cost: entry.unit_cost,
            effective_from: effectiveDate,
            source: entry.source ?? 'MANUAL',
            notes: entry.notes ?? null,
            user_id: ctx.userId,
          },
        });
        created++;
      }
    }

    return { created, updated, total: dto.entries.length };
  }

  async getMissing(ctx: OwnershipContext, startDate: string, endDate: string) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const lines = await this.prisma.shopifyLineItem.findMany({
      where: {
        unit_cost: null,
        shopify_order: {
          created_at: { gte: new Date(startDate), lte: new Date(endDate) },
          ...(ownerFilter.user_id
            ? { shopify_connection: { user_id: ownerFilter.user_id } }
            : {}),
        },
      },
      select: {
        shopify_variant_id: true,
        sku: true,
        title: true,
        net_sales: true,
        quantity: true,
        shopify_order_id: true,
      },
      orderBy: { net_sales: 'desc' },
    });

    const aggregated = new Map<
      string,
      {
        variant_id: string | null;
        sku: string | null;
        title: string;
        net_sales: number;
        quantity: number;
      }
    >();
    for (const line of lines) {
      const key =
        line.shopify_variant_id ||
        line.sku ||
        `unknown-${line.shopify_order_id}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.net_sales += Number(line.net_sales);
        existing.quantity += line.quantity;
      } else {
        aggregated.set(key, {
          variant_id: line.shopify_variant_id,
          sku: line.sku,
          title: line.title,
          net_sales: Number(line.net_sales),
          quantity: line.quantity,
        });
      }
    }

    const sorted = Array.from(aggregated.values()).sort(
      (a, b) => b.net_sales - a.net_sales,
    );
    const totalPending = sorted.reduce((sum, p) => sum + p.net_sales, 0);

    return {
      products: sorted,
      total_pending_to_cost: totalPending,
      count: sorted.length,
    };
  }
}
