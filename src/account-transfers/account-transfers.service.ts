import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  OwnershipContext,
  buildOwnerFilter,
  effectiveOwnerId,
  visibleCategoriesFilter,
} from '../common/ownership';
import { endOfDayInZone, startOfDayInZone } from '../common/timezone';
import { CloseGuard } from '../monthly-close/close-guard';
import { assertCategoryNotPayroll } from '../payroll/payroll-category.guard';
import {
  CreateAccountTransferDto,
  FilterAccountTransfersDto,
  UpdateAccountTransferDto,
} from './dto/account-transfer.dto';
import { AccountTransferEntity } from './entities/account-transfer.entity';

const Decimal = Prisma.Decimal;

/*
 * La fecha de un traspaso es de calendario. Se toma sólo `YYYY-MM-DD` y se ancla
 * a la medianoche de la zona del negocio: tomada como instante UTC, `2027-01-01`
 * caería el 31 de diciembre en CDMX y el traspaso contaría en el año anterior.
 */
const toInstant = (value: string) => startOfDayInZone(value.slice(0, 10));

const INCLUDE = {
  from_account: { select: { id: true, name: true } },
  to_account: { select: { id: true, name: true } },
  fee_expense: { select: { category_id: true } },
  creator: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AccountTransferInclude;

type Tx = Prisma.TransactionClient;

/*
 * Traspasos entre cuentas del mismo dueño. Un traspaso no es ingreso ni gasto:
 * sólo lo lee el saldo calculado de las cuentas (`getCashReport`). Lo único que
 * llega al estado de resultados es la comisión, que se guarda como un Expense
 * normal ligado al traspaso y se crea, edita y borra con él.
 * Ver openspec/changes/add-account-transfers.
 */
@Injectable()
export class AccountTransfersService {
  constructor(
    private prisma: PrismaService,
    private closeGuard: CloseGuard,
  ) {}

  async findAll(ctx: OwnershipContext, filters: FilterAccountTransfersDto) {
    const where: Prisma.AccountTransferWhereInput = {
      ...buildOwnerFilter(ctx),
    };
    if (filters.account_id) {
      where.OR = [
        { from_account_id: filters.account_id },
        { to_account_id: filters.account_id },
      ];
    }
    if (filters.start_date || filters.end_date) {
      where.date = {
        ...(filters.start_date
          ? { gte: startOfDayInZone(filters.start_date.slice(0, 10)) }
          : {}),
        ...(filters.end_date
          ? { lte: endOfDayInZone(filters.end_date.slice(0, 10)) }
          : {}),
      };
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const order = filters.order === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.accountTransfer.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ date: order }, { id: order }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountTransfer.count({ where }),
    ]);

    return {
      data: rows.map((r) => new AccountTransferEntity(r)),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    return new AccountTransferEntity(await this.getOwned(ctx, id));
  }

  async create(ctx: OwnershipContext, dto: CreateAccountTransferDto) {
    const ownerId = effectiveOwnerId(ctx);
    const date = toInstant(dto.date);
    const feeAmount = new Decimal(dto.fee_amount ?? 0);

    const { from, to } = await this.resolveAccounts(
      ownerId,
      dto.from_account_id,
      dto.to_account_id,
    );
    if (feeAmount.gt(0)) {
      await this.assertFeeCategory(ownerId, dto.fee_category_id);
    }
    await this.closeGuard.ensureOpen(ownerId, date);

    const row = await this.prisma.$transaction(async (tx) => {
      const feeExpenseId = feeAmount.gt(0)
        ? (
            await tx.expense.create({
              data: this.feeExpenseData(ctx, {
                amount: feeAmount,
                date,
                from,
                to,
                categoryId: dto.fee_category_id!,
              }),
            })
          ).id
        : null;

      return tx.accountTransfer.create({
        data: {
          from_account_id: from.id,
          to_account_id: to.id,
          amount: new Decimal(dto.amount),
          date,
          fee_amount: feeAmount,
          fee_expense_id: feeExpenseId,
          notes: dto.notes ?? null,
          user_id: ownerId,
          created_by: ctx.userId,
        },
        include: INCLUDE,
      });
    });

    return new AccountTransferEntity(row);
  }

  async update(
    ctx: OwnershipContext,
    id: number,
    dto: UpdateAccountTransferDto,
  ) {
    const existing = await this.getOwned(ctx, id);
    const ownerId = existing.user_id;

    const date = dto.date !== undefined ? toInstant(dto.date) : existing.date;
    const amount =
      dto.amount !== undefined ? new Decimal(dto.amount) : existing.amount;
    const feeAmount =
      dto.fee_amount !== undefined
        ? new Decimal(dto.fee_amount)
        : new Decimal(existing.fee_amount);
    const feeCategoryId =
      dto.fee_category_id ?? existing.fee_expense?.category_id ?? undefined;

    const { from, to } = await this.resolveAccounts(
      ownerId,
      dto.from_account_id ?? existing.from_account_id,
      dto.to_account_id ?? existing.to_account_id,
    );
    if (
      feeAmount.gt(0) &&
      (dto.fee_category_id !== undefined || !existing.fee_expense_id)
    ) {
      await this.assertFeeCategory(ownerId, feeCategoryId);
    }

    await this.closeGuard.ensureOpen(ownerId, existing.date);
    if (date.getTime() !== existing.date.getTime()) {
      await this.closeGuard.ensureOpen(ownerId, date);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      let feeExpenseId = existing.fee_expense_id;

      if (feeAmount.gt(0)) {
        const data = this.feeExpenseData(ctx, {
          amount: feeAmount,
          date,
          from,
          to,
          categoryId: feeCategoryId!,
        });
        if (feeExpenseId) {
          /* Quien capturó el gasto y de quién son los libros no cambian al editar. */
          await tx.expense.update({
            where: { id: feeExpenseId },
            data: {
              amount: data.amount,
              concept: data.concept,
              date: data.date,
              paid_at: data.paid_at,
              account_id: data.account_id,
              category_id: data.category_id,
            },
          });
        } else {
          feeExpenseId = (await tx.expense.create({ data })).id;
        }
      }

      const updated = await tx.accountTransfer.update({
        where: { id },
        data: {
          from_account_id: from.id,
          to_account_id: to.id,
          amount,
          date,
          fee_amount: feeAmount,
          fee_expense_id: feeAmount.gt(0) ? feeExpenseId : null,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        include: INCLUDE,
      });

      if (!feeAmount.gt(0) && existing.fee_expense_id) {
        await this.deleteFeeExpense(tx, existing.fee_expense_id);
      }
      return updated;
    });

    return new AccountTransferEntity(row);
  }

  async remove(ctx: OwnershipContext, id: number) {
    const existing = await this.getOwned(ctx, id);
    await this.closeGuard.ensureOpen(existing.user_id, existing.date);

    await this.prisma.$transaction(async (tx) => {
      await tx.accountTransfer.delete({ where: { id } });
      if (existing.fee_expense_id) {
        await this.deleteFeeExpense(tx, existing.fee_expense_id);
      }
    });
    return { id };
  }

  private async getOwned(ctx: OwnershipContext, id: number) {
    const row = await this.prisma.accountTransfer.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException(`Account transfer ${id} not found`);
    return row;
  }

  /*
   * Las dos cuentas deben ser del dueño de los libros del traspaso, aunque el
   * alcance del rol sea ANY: el alcance amplía lo que se lee, no a qué libros
   * se puede mover dinero. Una cuenta ajena responde igual que una que no
   * existe.
   */
  private async resolveAccounts(ownerId: number, fromId: number, toId: number) {
    if (fromId === toId) {
      throw new BadRequestException(
        'La cuenta origen y la cuenta destino deben ser distintas',
      );
    }
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [fromId, toId] }, user_id: ownerId },
      select: { id: true, name: true },
    });
    const from = accounts.find((a) => a.id === fromId);
    const to = accounts.find((a) => a.id === toId);
    if (!from) throw new NotFoundException(`Account ${fromId} not found`);
    if (!to) throw new NotFoundException(`Account ${toId} not found`);
    return { from, to };
  }

  /*
   * La categoría decide en qué renglón del estado de resultados cae la
   * comisión, así que no se adivina: la elige quien captura.
   */
  private async assertFeeCategory(ownerId: number, categoryId?: number) {
    if (!categoryId) {
      throw new BadRequestException(
        'fee_category_id es obligatorio cuando fee_amount es mayor a 0',
      );
    }
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, ...visibleCategoriesFilter(ownerId) },
      select: { id: true, type: true },
    });
    if (!category) {
      throw new NotFoundException(`Expense category ${categoryId} not found`);
    }
    assertCategoryNotPayroll(category);
  }

  private feeExpenseData(
    ctx: OwnershipContext,
    fee: {
      amount: Prisma.Decimal;
      date: Date;
      from: { id: number; name: string };
      to: { id: number; name: string };
      categoryId: number;
    },
  ) {
    return {
      amount: fee.amount,
      concept: `Comisión por traspaso ${fee.from.name} → ${fee.to.name}`,
      date: fee.date,
      paid_at: fee.date,
      status: 'PAID' as const,
      invoiced: false,
      invoice_status: 'NOT_INVOICED' as const,
      account_id: fee.from.id,
      category_id: fee.categoryId,
      user_id: effectiveOwnerId(ctx),
      created_by: ctx.userId,
    };
  }

  /* Si alguien ya borró el gasto desde la app, no hay nada que borrar. */
  private async deleteFeeExpense(tx: Tx, expenseId: number) {
    await tx.expense.deleteMany({ where: { id: expenseId } });
  }
}
