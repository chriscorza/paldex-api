import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, AccountType } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { FilterAccountsDto } from './dto/filter-accounts.dto';
import {
  PaginatedAccountResponse,
  AccountDetail,
  AccountEntity,
} from './entities/account.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    ctx: OwnershipContext,
    filters: FilterAccountsDto,
  ): Promise<PaginatedAccountResponse> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = {
      ...this.buildWhere(filters),
      ...buildOwnerFilter(ctx),
    };
    const orderBy = this.buildOrderBy(filters);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.account.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.account.count({ where }),
    ]);

    return { data: data.map((a) => new AccountEntity(a)), total, page, limit };
  }

  async findOne(ctx: OwnershipContext, id: number): Promise<AccountDetail> {
    const account = await this.prisma.account.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: {
        _count: {
          select:
            ctx.scope === 'OWN'
              ? {
                  incomes: { where: { user_id: ctx.userId } },
                  expenses: { where: { user_id: ctx.userId } },
                }
              : { incomes: true, expenses: true },
        },
      },
    });
    if (!account) {
      throw new NotFoundException(`Account with id ${id} not found`);
    }
    const { _count, ...rest } = account;
    const entity = new AccountEntity(rest);
    return {
      ...entity,
      incomes_count: _count.incomes,
      expenses_count: _count.expenses,
    } as any;
  }

  async create(ctx: OwnershipContext, dto: CreateAccountDto) {
    this.assertCreditLimitCoherence(dto.type, dto.credit_limit);
    if (dto.currency && dto.currency !== 'MXN') {
      throw new BadRequestException('Only MXN currency is supported');
    }
    const account = await this.prisma.account.create({
      data: {
        name: dto.name,
        balance: dto.balance,
        type: dto.type,
        credit_limit: dto.credit_limit ?? null,
        currency: dto.currency ?? 'MXN',
        is_active: dto.is_active ?? true,
        initial_balance: dto.initial_balance ?? dto.balance,
        user_id: ctx.userId,
      },
    });
    return new AccountEntity(account);
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateAccountDto) {
    const existing = await this.prisma.account.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) {
      throw new NotFoundException(`Account with id ${id} not found`);
    }

    if (dto.currency && dto.currency !== existing.currency) {
      const movementCount =
        (await this.prisma.expense.count({ where: { account_id: id } })) +
        (await this.prisma.income.count({ where: { account_id: id } }));
      if (movementCount > 0) {
        throw new BadRequestException(
          'Cannot change currency of an account with movements',
        );
      }
      if (dto.currency !== 'MXN') {
        throw new BadRequestException('Only MXN currency is supported');
      }
    }

    const mergedType = dto.type ?? existing.type;
    const mergedCreditLimit =
      dto.type !== undefined
        ? (dto.credit_limit ?? null)
        : dto.credit_limit !== undefined
          ? dto.credit_limit
          : existing.credit_limit !== null
            ? Number(existing.credit_limit)
            : undefined;

    this.assertCreditLimitCoherence(mergedType, mergedCreditLimit);

    const data: Prisma.AccountUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.balance !== undefined) data.balance = dto.balance;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.initial_balance !== undefined)
      data.initial_balance = dto.initial_balance;

    if (dto.type !== undefined) {
      if (dto.type !== 'CREDIT_CARD') {
        data.credit_limit = null;
      } else if (dto.credit_limit !== undefined) {
        data.credit_limit = dto.credit_limit;
      }
    } else if (dto.credit_limit !== undefined) {
      data.credit_limit = dto.credit_limit;
    }

    const updated = await this.prisma.account.update({
      where: { id },
      data,
    });
    return new AccountEntity(updated);
  }

  async remove(ctx: OwnershipContext, id: number) {
    const account = await this.prisma.account.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: {
        _count: {
          select:
            ctx.scope === 'OWN'
              ? {
                  incomes: { where: { user_id: ctx.userId } },
                  expenses: { where: { user_id: ctx.userId } },
                }
              : { incomes: true, expenses: true },
        },
      },
    });
    if (!account) {
      throw new NotFoundException(`Account with id ${id} not found`);
    }

    const incomeCount = account._count.incomes;
    const expenseCount = account._count.expenses;

    if (incomeCount + expenseCount > 0) {
      throw new ConflictException(
        `Cannot delete account: ${incomeCount} incomes and ${expenseCount} expenses are associated`,
      );
    }

    try {
      const deleted = await this.prisma.account.delete({ where: { id } });
      return new AccountEntity(deleted);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete account: associated records exist',
        );
      }
      throw error;
    }
  }

  private assertCreditLimitCoherence(
    type: AccountType,
    credit_limit?: number,
  ): void {
    if (type === 'CREDIT_CARD') {
      if (credit_limit === undefined || credit_limit === null) {
        throw new BadRequestException(
          'credit_limit is required for CREDIT_CARD accounts',
        );
      }
    } else {
      if (credit_limit !== undefined && credit_limit !== null) {
        throw new BadRequestException(
          'credit_limit is only allowed for CREDIT_CARD accounts',
        );
      }
    }
  }

  private buildWhere(filters: FilterAccountsDto): Prisma.AccountWhereInput {
    const where: Prisma.AccountWhereInput = {};

    if (filters.search) {
      where.name = { contains: filters.search };
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.is_active !== undefined) {
      where.is_active = filters.is_active;
    }

    return where;
  }

  private buildOrderBy(
    filters: FilterAccountsDto,
  ): Prisma.AccountOrderByWithRelationInput {
    const sort_by = filters.sort_by ?? 'created_at';
    const order = filters.order ?? 'desc';
    return { [sort_by]: order };
  }
}
