import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { CreateIncomeDto, UpdateIncomeDto } from './dto/create-income.dto';
import { FilterIncomesDto } from './dto/filter-incomes.dto';
import {
  IncomeEntity,
  INCOME_PUBLIC_SELECT,
  PaginatedIncomeResponse,
} from './entities/income.entity';
import {
  buildDateRangeFilter,
  buildSearchFilter,
  buildOrderBy as buildOrder,
  buildPagination,
  paginatedResponse,
} from '../common/filters';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;

@Injectable()
export class IncomesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    ctx: OwnershipContext,
    filters: FilterIncomesDto,
  ): Promise<PaginatedIncomeResponse> {
    const pagination = buildPagination(filters.page, filters.limit);
    const where = {
      ...this.buildWhere(filters),
      ...buildOwnerFilter(ctx),
    };
    const orderBy = buildOrder(filters.sort_by, filters.order, 'date', 'desc');

    const [data, total] = await this.prisma.$transaction([
      this.prisma.income.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
        select: INCOME_PUBLIC_SELECT,
      }),
      this.prisma.income.count({ where }),
    ]);

    return paginatedResponse(
      data.map((i) => new IncomeEntity(i)),
      total,
      pagination.page,
      pagination.limit,
    );
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const income = await this.prisma.income.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      select: INCOME_PUBLIC_SELECT,
    });
    if (!income) {
      throw new NotFoundException(`Income with id ${id} not found`);
    }
    return new IncomeEntity(income);
  }

  async create(ctx: OwnershipContext, dto: CreateIncomeDto) {
    await this.validateForeignKeys(ctx, dto.account_id, dto.tax_ids);

    const { net_amount, gross_amount: finalGross } =
      this.calculateNetAndGross(dto);

    try {
      const income = await this.prisma.income.create({
        data: {
          user_id: ctx.userId,
          amount: dto.amount,
          concept: dto.concept,
          date: dto.date,
          invoiced: dto.invoiced,
          account_id: dto.account_id,
          income_type: dto.income_type ?? 'OTHER',
          channel: dto.channel ?? null,
          gross_amount: finalGross,
          discount_total: dto.discount_total ?? 0,
          fee_total: dto.fee_total ?? 0,
          shipping_charged: dto.shipping_charged ?? 0,
          shipping_cost: dto.shipping_cost ?? 0,
          net_amount,
          taxes: dto.tax_ids?.length
            ? { create: dto.tax_ids.map((tax_id) => ({ tax_id })) }
            : undefined,
        },
        select: INCOME_PUBLIC_SELECT,
      });
      return new IncomeEntity(income);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Foreign key constraint failed: referenced record does not exist',
        );
      }
      throw error;
    }
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateIncomeDto) {
    const existing = await this.prisma.income.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: { taxes: { include: { tax: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Income with id ${id} not found`);
    }

    if (dto.account_id !== undefined) {
      await this.validateForeignKeys(ctx, dto.account_id);
    }

    const { net_amount, gross_amount: finalGross } =
      this.calculateNetAndGrossFromExisting(existing, dto);

    const taxesUpdate =
      dto.tax_ids !== undefined
        ? {
            taxes: {
              deleteMany: {},
              create: dto.tax_ids.map((tax_id) => ({ tax_id })),
            },
          }
        : undefined;

    const updateData: any = {};

    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.concept !== undefined) updateData.concept = dto.concept;
    if (dto.date !== undefined) updateData.date = dto.date;
    if (dto.invoiced !== undefined) updateData.invoiced = dto.invoiced;
    if (dto.account_id !== undefined) updateData.account_id = dto.account_id;
    if (dto.income_type !== undefined) updateData.income_type = dto.income_type;
    if (dto.channel !== undefined) updateData.channel = dto.channel;
    if (dto.discount_total !== undefined)
      updateData.discount_total = dto.discount_total;
    if (dto.fee_total !== undefined) updateData.fee_total = dto.fee_total;
    if (dto.shipping_charged !== undefined)
      updateData.shipping_charged = dto.shipping_charged;
    if (dto.shipping_cost !== undefined)
      updateData.shipping_cost = dto.shipping_cost;

    if (dto.gross_amount !== undefined) {
      updateData.gross_amount = finalGross;
    }

    if (
      dto.gross_amount !== undefined ||
      dto.discount_total !== undefined ||
      dto.fee_total !== undefined ||
      dto.shipping_charged !== undefined ||
      dto.shipping_cost !== undefined ||
      dto.amount !== undefined
    ) {
      updateData.net_amount = net_amount;
    }

    if (taxesUpdate) Object.assign(updateData, taxesUpdate);

    try {
      const income = await this.prisma.income.update({
        where: { id },
        data: updateData,
        select: INCOME_PUBLIC_SELECT,
      });
      return new IncomeEntity(income);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Foreign key constraint failed: referenced record does not exist',
        );
      }
      throw error;
    }
  }

  async remove(ctx: OwnershipContext, id: number) {
    const existing = await this.prisma.income.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) {
      throw new NotFoundException(`Income with id ${id} not found`);
    }
    try {
      const income = await this.prisma.income.delete({
        where: { id },
        select: INCOME_PUBLIC_SELECT,
      });
      return new IncomeEntity(income);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Foreign key constraint failed: referenced record does not exist',
        );
      }
      throw error;
    }
  }

  private calculateNetAndGross(dto: any): {
    net_amount: Decimal | number;
    gross_amount: Decimal | number;
  } {
    const hasBreakdown =
      dto.gross_amount !== undefined ||
      dto.discount_total !== undefined ||
      dto.fee_total !== undefined ||
      dto.shipping_charged !== undefined ||
      dto.shipping_cost !== undefined;

    if (!hasBreakdown) {
      return {
        gross_amount: dto.amount,
        net_amount: dto.amount,
      };
    }

    const gross = dto.gross_amount ?? dto.amount;
    const discounts = dto.discount_total ?? 0;
    const fees = dto.fee_total ?? 0;
    const shippingCost = dto.shipping_cost ?? 0;

    const net = new Decimal(gross)
      .minus(new Decimal(discounts))
      .minus(new Decimal(fees))
      .minus(new Decimal(shippingCost));

    return {
      gross_amount: gross,
      net_amount: net.toNumber(),
    };
  }

  private calculateNetAndGrossFromExisting(
    existing: any,
    dto: any,
  ): { net_amount: Decimal | number; gross_amount: Decimal | number } {
    const resolved: any = {
      amount: dto.amount ?? Number(existing.amount),
      gross_amount:
        dto.gross_amount ??
        (existing.gross_amount !== null
          ? Number(existing.gross_amount)
          : undefined),
      discount_total:
        dto.discount_total ??
        (existing.discount_total !== null
          ? Number(existing.discount_total)
          : 0),
      fee_total:
        dto.fee_total ??
        (existing.fee_total !== null ? Number(existing.fee_total) : 0),
      shipping_charged:
        dto.shipping_charged ??
        (existing.shipping_charged !== null
          ? Number(existing.shipping_charged)
          : 0),
      shipping_cost:
        dto.shipping_cost ??
        (existing.shipping_cost !== null ? Number(existing.shipping_cost) : 0),
    };

    return this.calculateNetAndGross(resolved);
  }

  private buildWhere(filters: FilterIncomesDto): Prisma.IncomeWhereInput {
    const where: Prisma.IncomeWhereInput = {};

    const dateRange = buildDateRangeFilter(
      filters.start_date,
      filters.end_date,
    );
    if (dateRange) Object.assign(where, dateRange);

    const searchFilter = buildSearchFilter(filters.search);
    if (searchFilter) Object.assign(where, searchFilter);

    if (filters.account_id) where.account_id = filters.account_id;
    if (filters.income_type) where.income_type = filters.income_type;
    if (filters.channel) where.channel = filters.channel;
    if (filters.has_cogs !== undefined) {
      if (filters.has_cogs) {
        where.cogs_total = { not: null };
      } else {
        where.cogs_total = null;
      }
    }

    return where;
  }

  private async validateForeignKeys(
    ctx: OwnershipContext,
    account_id?: number,
    tax_ids?: number[],
  ): Promise<void> {
    if (account_id !== undefined) {
      const accountWhere: Prisma.AccountWhereInput = { id: account_id };
      if (ctx.scope === 'OWN') {
        accountWhere.user_id = ctx.userId;
      }
      const account = await this.prisma.account.findFirst({
        where: accountWhere,
      });
      if (!account) {
        throw new BadRequestException(
          `Account with id ${account_id} does not exist`,
        );
      }
    }

    if (tax_ids && tax_ids.length > 0) {
      const count = await this.prisma.tax.count({
        where: { id: { in: tax_ids } },
      });
      if (count !== tax_ids.length) {
        throw new BadRequestException('One or more tax_ids do not exist');
      }
    }
  }
}
