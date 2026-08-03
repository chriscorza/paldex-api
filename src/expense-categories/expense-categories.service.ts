import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
  FilterExpenseCategoriesDto,
} from './dto/create-expense-category.dto';
import { ExpenseCategoryType } from '@prisma/client';
import { EXPENSE_CATEGORY_PUBLIC_SELECT } from './entities/expense-category.entity';
import { OwnershipContext } from '../common/ownership';

const DEFAULT_FLAGS: Record<
  ExpenseCategoryType,
  {
    affects_gross_profit: boolean;
    affects_operating_profit: boolean;
    is_cash_outflow: boolean;
  }
> = {
  COGS: {
    affects_gross_profit: true,
    affects_operating_profit: false,
    is_cash_outflow: true,
  },
  OPERATING: {
    affects_gross_profit: false,
    affects_operating_profit: true,
    is_cash_outflow: true,
  },
  PAYROLL: {
    affects_gross_profit: false,
    affects_operating_profit: true,
    is_cash_outflow: true,
  },
  TAX: {
    affects_gross_profit: false,
    affects_operating_profit: true,
    is_cash_outflow: true,
  },
  SHOPIFY_FEES: {
    affects_gross_profit: true,
    affects_operating_profit: false,
    is_cash_outflow: true,
  },
  SHIPPING: {
    affects_gross_profit: true,
    affects_operating_profit: false,
    is_cash_outflow: true,
  },
  MARKETING: {
    affects_gross_profit: false,
    affects_operating_profit: true,
    is_cash_outflow: true,
  },
  DEBT: {
    affects_gross_profit: false,
    affects_operating_profit: false,
    is_cash_outflow: true,
  },
  OWNER: {
    affects_gross_profit: false,
    affects_operating_profit: false,
    is_cash_outflow: true,
  },
  OTHER: {
    affects_gross_profit: false,
    affects_operating_profit: true,
    is_cash_outflow: true,
  },
};

const SYSTEM_CATEGORIES: {
  name: string;
  type: ExpenseCategoryType;
  overrides?: Partial<(typeof DEFAULT_FLAGS)[ExpenseCategoryType]>;
}[] = [
  { name: 'Compra de mercancía', type: 'COGS' },
  { name: 'Renta local', type: 'OPERATING' },
  { name: 'Servicios (agua, luz, internet)', type: 'OPERATING' },
  { name: 'Material de empaque', type: 'OPERATING' },
  { name: 'Comisión Shopify', type: 'SHOPIFY_FEES' },
  { name: 'Comisión pasarela de pago', type: 'SHOPIFY_FEES' },
  { name: 'Envío al cliente', type: 'SHIPPING' },
  { name: 'Devolución de envío', type: 'SHIPPING' },
  { name: 'Meta Ads', type: 'MARKETING' },
  { name: 'Google Ads', type: 'MARKETING' },
  {
    name: 'Intereses de deuda',
    type: 'DEBT',
    overrides: { affects_operating_profit: true },
  },
  {
    name: 'Pago de capital de deuda',
    type: 'DEBT',
    overrides: { affects_operating_profit: false },
  },
  { name: 'Retiro del dueño', type: 'OWNER' },
  { name: 'Reinversión', type: 'OWNER' },
  { name: 'Honorarios contador', type: 'TAX' },
  { name: 'Nómina (manual)', type: 'PAYROLL' },
  { name: 'Otro gasto', type: 'OTHER' },
];

@Injectable()
export class ExpenseCategoriesService {
  constructor(private prisma: PrismaService) {}

  async seedSystemCategories(userId: number): Promise<void> {
    for (const cat of SYSTEM_CATEGORIES) {
      const defaults = DEFAULT_FLAGS[cat.type];
      await this.prisma.expenseCategory.upsert({
        where: {
          user_id_name_type: {
            user_id: userId,
            name: cat.name,
            type: cat.type,
          },
        },
        update: {},
        create: {
          name: cat.name,
          type: cat.type,
          is_system: true,
          affects_gross_profit:
            cat.overrides?.affects_gross_profit ??
            defaults.affects_gross_profit,
          affects_operating_profit:
            cat.overrides?.affects_operating_profit ??
            defaults.affects_operating_profit,
          is_cash_outflow:
            cat.overrides?.is_cash_outflow ?? defaults.is_cash_outflow,
          user_id: userId,
        },
      });
    }
  }

  async findAll(ctx: OwnershipContext, filters: FilterExpenseCategoriesDto) {
    const where: any = {};
    const ownerFilter =
      ctx.scope === 'OWN'
        ? { OR: [{ user_id: ctx.userId }, { is_system: true }] }
        : {};
    Object.assign(where, ownerFilter);

    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.is_system !== undefined) {
      where.is_system = filters.is_system;
    }

    const page = filters.page || 1;
    const limit = filters.limit || 100;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where,
        select: EXPENSE_CATEGORY_PUBLIC_SELECT,
        skip,
        take: limit,
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.expenseCategory.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const where: any = { id };
    if (ctx.scope === 'OWN') {
      where.OR = [{ user_id: ctx.userId }, { is_system: true }];
    }

    const category = await this.prisma.expenseCategory.findFirst({
      where,
      select: EXPENSE_CATEGORY_PUBLIC_SELECT,
    });

    if (!category) {
      throw new NotFoundException('Expense category not found');
    }

    return category;
  }

  async create(ctx: OwnershipContext, dto: CreateExpenseCategoryDto) {
    const defaults = DEFAULT_FLAGS[dto.type];

    try {
      return await this.prisma.expenseCategory.create({
        data: {
          name: dto.name,
          type: dto.type,
          is_system: false,
          affects_gross_profit:
            dto.affects_gross_profit ?? defaults.affects_gross_profit,
          affects_operating_profit:
            dto.affects_operating_profit ?? defaults.affects_operating_profit,
          is_cash_outflow: dto.is_cash_outflow ?? defaults.is_cash_outflow,
          user_id: ctx.userId,
        },
        select: EXPENSE_CATEGORY_PUBLIC_SELECT,
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'A category with this name and type already exists',
        );
      }
      throw error;
    }
  }

  async update(
    ctx: OwnershipContext,
    id: number,
    dto: UpdateExpenseCategoryDto,
  ) {
    const category = await this.findOne(ctx, id);

    if (category.is_system) {
      throw new BadRequestException('Cannot modify system categories');
    }

    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.affects_gross_profit !== undefined && {
          affects_gross_profit: dto.affects_gross_profit,
        }),
        ...(dto.affects_operating_profit !== undefined && {
          affects_operating_profit: dto.affects_operating_profit,
        }),
        ...(dto.is_cash_outflow !== undefined && {
          is_cash_outflow: dto.is_cash_outflow,
        }),
      },
      select: EXPENSE_CATEGORY_PUBLIC_SELECT,
    });
  }

  async remove(ctx: OwnershipContext, id: number) {
    const category = await this.findOne(ctx, id);

    if (category.is_system) {
      throw new ConflictException('Cannot delete system categories');
    }

    const expenseCount = await this.prisma.expense.count({
      where: { category_id: id },
    });

    if (expenseCount > 0) {
      throw new ConflictException(
        'Cannot delete a category that has associated expenses',
      );
    }

    return this.prisma.expenseCategory.delete({
      where: { id },
      select: EXPENSE_CATEGORY_PUBLIC_SELECT,
    });
  }
}
