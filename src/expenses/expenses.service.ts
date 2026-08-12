import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, ExpenseStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { CreateExpenseDto, PayExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { FilterExpensesDto } from './dto/filter-expenses.dto';
import {
  ExpenseEntity,
  EXPENSE_PUBLIC_INCLUDE,
} from './entities/expense.entity';
import {
  buildDateRangeFilter,
  buildSearchFilter,
  buildOrderBy,
  buildPagination,
  paginatedResponse,
} from '../common/filters';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { startOfDayInZone } from '../common/timezone';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async findAll(ctx: OwnershipContext, filters: FilterExpensesDto) {
    const pagination = buildPagination(filters.page, filters.limit);
    const where = {
      ...this.buildWhere(filters),
      ...buildOwnerFilter(ctx),
    };
    const orderBy = buildOrderBy(
      filters.sort_by,
      filters.order,
      'date',
      'desc',
    );

    const [data, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
        include: EXPENSE_PUBLIC_INCLUDE,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return paginatedResponse(
      data.map((e) => new ExpenseEntity(e)),
      total,
      pagination.page,
      pagination.limit,
    );
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: EXPENSE_PUBLIC_INCLUDE,
    });
    if (!expense) {
      throw new NotFoundException(`Expense with id ${id} not found`);
    }
    return new ExpenseEntity(expense);
  }

  async create(ctx: OwnershipContext, dto: CreateExpenseDto) {
    await this.validateForeignKeys(
      ctx,
      dto.account_id,
      dto.tax_ids,
      dto.category_id,
    );

    const status = dto.status || 'PAID';
    const paid_at = dto.paid_at || (status === 'PAID' ? dto.date : null);
    this.validateStatusDateCoherence(status, paid_at, true);

    const invoice_status = this.deriveInvoiceStatus(
      dto.invoice_status,
      dto.invoiced,
    );
    const tax_creditable_amount = this.calculateTaxCreditable(
      invoice_status,
      dto.is_tax_deductible ?? true,
      dto.tax_amount,
    );

    try {
      const expense = await this.prisma.expense.create({
        data: {
          user_id: ctx.userId,
          amount: dto.amount,
          concept: dto.concept,
          date: startOfDayInZone(dto.date),
          invoiced: invoice_status === 'INVOICED',
          account_id: dto.account_id,
          category_id: dto.category_id ?? null,
          vendor: dto.vendor ?? null,
          status: status as ExpenseStatus,
          paid_at: paid_at ? startOfDayInZone(paid_at) : null,
          invoice_status: invoice_status as InvoiceStatus,
          invoice_uuid: dto.invoice_uuid ?? null,
          supplier_rfc: dto.supplier_rfc ?? null,
          subtotal: dto.subtotal ?? null,
          tax_amount: dto.tax_amount ?? null,
          withholding_amount: dto.withholding_amount ?? null,
          is_tax_deductible: dto.is_tax_deductible ?? true,
          tax_creditable_amount,
          taxes: dto.tax_ids?.length
            ? { create: dto.tax_ids.map((tax_id) => ({ tax_id })) }
            : undefined,
        },
        include: EXPENSE_PUBLIC_INCLUDE,
      });
      return new ExpenseEntity(expense);
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

  async update(ctx: OwnershipContext, id: number, dto: UpdateExpenseDto) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: EXPENSE_PUBLIC_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException(`Expense with id ${id} not found`);
    }

    if (dto.account_id !== undefined) {
      await this.validateForeignKeys(
        ctx,
        dto.account_id,
        undefined,
        dto.category_id,
      );
    }

    const status = dto.status ?? existing.status;
    const paid_at = dto.paid_at ?? existing.paid_at?.toISOString();
    this.validateStatusDateCoherence(status, paid_at, false);

    const invoice_status = this.deriveInvoiceStatus(
      dto.invoice_status ?? existing.invoice_status,
      dto.invoiced ?? existing.invoiced,
    );
    const is_tax_deductible =
      dto.is_tax_deductible ?? existing.is_tax_deductible;
    const tax_amount = dto.tax_amount ?? existing.tax_amount;
    const tax_creditable_amount = this.calculateTaxCreditable(
      invoice_status,
      is_tax_deductible,
      tax_amount ? Number(tax_amount) : undefined,
    );

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
    if (dto.date !== undefined) updateData.date = startOfDayInZone(dto.date);
    if (dto.invoiced !== undefined) updateData.invoiced = dto.invoiced;
    if (dto.account_id !== undefined) updateData.account_id = dto.account_id;
    if (dto.category_id !== undefined) updateData.category_id = dto.category_id;
    if (dto.vendor !== undefined) updateData.vendor = dto.vendor;
    if (dto.status !== undefined) updateData.status = status;
    if (dto.paid_at !== undefined || dto.status !== undefined)
      updateData.paid_at = paid_at ? startOfDayInZone(paid_at) : null;
    if (dto.invoice_status !== undefined)
      updateData.invoice_status = invoice_status;
    if (dto.invoiced !== undefined || dto.invoice_status !== undefined)
      updateData.invoiced = invoice_status === 'INVOICED';
    if (dto.invoice_uuid !== undefined)
      updateData.invoice_uuid = dto.invoice_uuid;
    if (dto.supplier_rfc !== undefined)
      updateData.supplier_rfc = dto.supplier_rfc;
    if (dto.subtotal !== undefined) updateData.subtotal = dto.subtotal;
    if (dto.tax_amount !== undefined) updateData.tax_amount = dto.tax_amount;
    if (dto.withholding_amount !== undefined)
      updateData.withholding_amount = dto.withholding_amount;
    if (dto.is_tax_deductible !== undefined)
      updateData.is_tax_deductible = dto.is_tax_deductible;
    updateData.tax_creditable_amount = tax_creditable_amount;

    if (taxesUpdate) Object.assign(updateData, taxesUpdate);

    try {
      const expense = await this.prisma.expense.update({
        where: { id },
        data: updateData,
        include: EXPENSE_PUBLIC_INCLUDE,
      });
      return new ExpenseEntity(expense);
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
    const existing = await this.prisma.expense.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) {
      throw new NotFoundException(`Expense with id ${id} not found`);
    }
    try {
      const expense = await this.prisma.expense.delete({
        where: { id },
        include: EXPENSE_PUBLIC_INCLUDE,
      });
      return new ExpenseEntity(expense);
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

  async pay(ctx: OwnershipContext, id: number, dto: PayExpenseDto) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) {
      throw new NotFoundException(`Expense with id ${id} not found`);
    }

    if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
      throw new ConflictException(`Expense is already ${existing.status}`);
    }

    const account_id = dto.account_id ?? existing.account_id;
    if (dto.account_id) {
      await this.validateForeignKeys(ctx, account_id);
      const account = await this.prisma.account.findFirst({
        where: { id: account_id },
      });
      if (account && !account.is_active) {
        throw new BadRequestException(
          'Cannot use an inactive account for payment',
        );
      }
    }

    const paid_at = dto.paid_at ? new Date(dto.paid_at) : new Date();
    const amount = dto.amount ?? existing.amount;

    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        status: 'PAID',
        paid_at,
        account_id,
        amount,
      },
      include: EXPENSE_PUBLIC_INCLUDE,
    });

    return new ExpenseEntity(expense);
  }

  private buildWhere(filters: FilterExpensesDto): Prisma.ExpenseWhereInput {
    const where: Prisma.ExpenseWhereInput = {};

    const dateRange = buildDateRangeFilter(
      filters.start_date,
      filters.end_date,
    );
    if (dateRange) Object.assign(where, dateRange);

    const searchFilter = buildSearchFilter(filters.search);
    if (searchFilter) Object.assign(where, searchFilter);

    if (filters.account_id) where.account_id = filters.account_id;
    if (filters.category_id) where.category_id = filters.category_id;
    if (filters.status) where.status = filters.status;
    if (filters.invoice_status) where.invoice_status = filters.invoice_status;
    if (filters.vendor) where.vendor = { contains: filters.vendor };
    if (filters.is_tax_deductible !== undefined)
      where.is_tax_deductible = filters.is_tax_deductible;

    if (filters.category_type) {
      where.category = { type: filters.category_type };
    }

    return where;
  }

  private async validateForeignKeys(
    ctx: OwnershipContext,
    account_id?: number,
    tax_ids?: number[],
    category_id?: number,
  ): Promise<void> {
    if (account_id !== undefined) {
      const accountWhere: Prisma.AccountWhereInput = { id: account_id };
      if (ctx.scope === 'OWN') accountWhere.user_id = ctx.userId;
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

    if (category_id !== undefined && category_id !== null) {
      const catWhere: any = { id: category_id };
      if (ctx.scope === 'OWN') {
        catWhere.OR = [{ user_id: ctx.userId }, { is_system: true }];
      }
      const category = await this.prisma.expenseCategory.findFirst({
        where: catWhere,
      });
      if (!category) {
        throw new BadRequestException(
          `Expense category with id ${category_id} does not exist`,
        );
      }
    }
  }

  private validateStatusDateCoherence(
    status: string,
    paid_at: string | null | undefined,
    isCreate: boolean,
  ) {
    if (status === 'PAID' && !paid_at) {
      if (!isCreate) {
        throw new BadRequestException('status PAID requires paid_at');
      }
    }
    if (status !== 'PAID' && paid_at) {
      throw new BadRequestException(
        'paid_at can only be set when status is PAID',
      );
    }
  }

  private deriveInvoiceStatus(
    clientStatus: string | undefined,
    invoiced: boolean,
  ): string {
    if (clientStatus) return clientStatus;
    return invoiced ? 'INVOICED' : 'NOT_INVOICED';
  }

  private calculateTaxCreditable(
    invoice_status: string,
    is_tax_deductible: boolean,
    tax_amount?: number,
  ): number {
    if (
      invoice_status === 'INVOICED' &&
      is_tax_deductible &&
      tax_amount !== undefined
    ) {
      return tax_amount;
    }
    return 0;
  }
}
