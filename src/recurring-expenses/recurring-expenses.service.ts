import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
  GenerateRecurringDto,
} from './dto/recurring-expense.dto';
import {
  RecurringExpenseEntity,
  RECURRING_SELECT,
} from './entities/recurring-expense.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { calculateDueDates, Frequency } from '../payroll/payroll-schedule';
import { CloseGuard } from '../monthly-close/close-guard';
import { Prisma as PrismaClient } from '@prisma/client';

const Decimal = PrismaClient.Decimal;

@Injectable()
export class RecurringExpensesService {
  constructor(
    private prisma: PrismaService,
    private closeGuard: CloseGuard,
  ) {}

  async findAll(ctx: OwnershipContext, page = 1, limit = 50) {
    const where = { ...buildOwnerFilter(ctx) };
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.recurringExpense.findMany({
        where,
        select: RECURRING_SELECT,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.recurringExpense.count({ where }),
    ]);
    return {
      data: data.map((r) => new RecurringExpenseEntity(r)),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const r = await this.prisma.recurringExpense.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      select: RECURRING_SELECT,
    });
    if (!r) throw new NotFoundException('Recurring expense not found');
    return new RecurringExpenseEntity(r);
  }

  async create(ctx: OwnershipContext, dto: CreateRecurringExpenseDto) {
    return new RecurringExpenseEntity(
      await this.prisma.recurringExpense.create({
        data: {
          concept: dto.concept,
          amount: dto.amount,
          category_id: dto.category_id,
          account_id: dto.account_id ?? null,
          frequency: dto.frequency,
          due_day_of_week: dto.due_day_of_week ?? null,
          due_day_of_month: dto.due_day_of_month ?? null,
          second_due_day_of_month: dto.second_due_day_of_month ?? null,
          /*
           * Prisma quiere un DateTime, no la cadena del DTO: un `2025-05-06`
           * a secas revienta con «premature end of input». `end_date` sí se
           * convertía, `start_date` no, así que dar de alta una plantilla con
           * fecha de inicio siempre fallaba con un 500.
           */
          start_date: dto.start_date ? new Date(dto.start_date) : new Date(),
          end_date: dto.end_date ? new Date(dto.end_date) : null,
          active: dto.active ?? true,
          auto_generate: dto.auto_generate ?? true,
          requires_confirmation: dto.requires_confirmation ?? true,
          invoice_status: dto.invoice_status ?? 'NOT_INVOICED',
          tax_rate: dto.tax_rate ?? null,
          notes: dto.notes ?? null,
          user_id: ctx.userId,
        },
        select: RECURRING_SELECT,
      }),
    );
  }

  async update(
    ctx: OwnershipContext,
    id: number,
    dto: UpdateRecurringExpenseDto,
  ) {
    await this.findOne(ctx, id);
    const data: any = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      /* Mismo motivo que en `create`: las fechas llegan como cadena. */
      data[k] =
        (k === 'start_date' || k === 'end_date') && v !== null
          ? new Date(v as string)
          : v;
    }
    return new RecurringExpenseEntity(
      await this.prisma.recurringExpense.update({
        where: { id },
        data,
        select: RECURRING_SELECT,
      }),
    );
  }

  async remove(ctx: OwnershipContext, id: number) {
    await this.findOne(ctx, id);
    const count = await this.prisma.expense.count({
      where: { recurring_expense_id: id },
    });
    if (count > 0)
      throw new ConflictException(
        `Cannot delete: ${count} expenses generated. Deactivate it instead.`,
      );
    await this.prisma.recurringExpense.delete({ where: { id } });
  }

  async generate(ctx: OwnershipContext, dto: GenerateRecurringDto) {
    const templates = await this.prisma.recurringExpense.findMany({
      where: { ...buildOwnerFilter(ctx), active: true, auto_generate: true },
    });

    const rangeStart = new Date(dto.start_date);
    const rangeEnd = new Date(dto.end_date);
    let created = 0;
    let paid = 0;
    const skipped: string[] = [];

    for (const tpl of templates) {
      const breakdown = this.splitTax(tpl.amount, tpl.tax_rate);
      const effectiveEnd =
        tpl.end_date && tpl.end_date < rangeEnd ? tpl.end_date : rangeEnd;
      const dueDates = calculateDueDates(
        {
          frequency: tpl.frequency as Frequency,
          weekly_day: tpl.due_day_of_week,
          biweekly_first_day: tpl.due_day_of_month,
          biweekly_second_day: tpl.second_due_day_of_month,
          monthly_day: tpl.due_day_of_month,
          yearly_month: tpl.due_day_of_month
            ? Math.ceil((tpl.due_day_of_month || 1) / 28) || 1
            : 1,
          yearly_day: tpl.due_day_of_month || 1,
        },
        rangeStart,
        effectiveEnd,
      );

      for (const dd of dueDates) {
        if (dd.scheduled_due_date < tpl.start_date) continue;

        /*
         * El futuro nunca se marca pagado aunque lo pidan: `already_paid` es
         * para cargar historia, y un rango que cruce hoy no debe dar por
         * liquidado lo que aún no ha vencido.
         */
        const alreadyPaid =
          dto.already_paid === true && dd.scheduled_due_date <= new Date();

        try {
          await this.closeGuard.ensureOpen(ctx.userId, dd.scheduled_due_date);
          await this.prisma.expense.create({
            data: {
              user_id: ctx.userId,
              amount: tpl.amount,
              concept: tpl.concept,
              date: dd.scheduled_due_date,
              account_id: tpl.account_id ?? undefined,
              category_id: tpl.category_id,
              status: alreadyPaid ? 'PAID' : 'PENDING',
              paid_at: alreadyPaid ? dd.scheduled_due_date : null,
              invoiced: tpl.invoice_status === 'INVOICED',
              invoice_status: tpl.invoice_status,
              is_tax_deductible: tpl.invoice_status !== 'NOT_DEDUCTIBLE',
              subtotal: breakdown.subtotal,
              tax_amount: breakdown.tax,
              tax_creditable_amount: breakdown.creditable,
              recurring_expense_id: tpl.id,
              scheduled_due_date: dd.scheduled_due_date,
              is_recurring: true,
            },
          });
          created++;
          if (alreadyPaid) paid++;
        } catch (e: any) {
          if (e.code === 'P2002') {
            skipped.push(
              `template ${tpl.id} on ${dd.scheduled_due_date.toISOString()}`,
            );
          } else if (e instanceof ConflictException) {
            skipped.push(
              `closed month for template ${tpl.id} on ${dd.scheduled_due_date.toISOString()}`,
            );
          } else {
            throw e;
          }
        }
      }
    }

    /* `paid` deja ver cuántos se dieron por liquidados, que no es evidente. */
    return { created, paid, skipped: skipped.length };
  }

  /*
   * Desglosa el IVA que ya viene dentro del importe: 1,000 al 16 % son 862.07
   * de subtotal y 137.93 de impuesto.
   *
   * Sin tasa no se inventa ninguno. El gasto queda sin desglose y con el
   * acreditable en cero, que es lo honesto cuando no se sabe si la factura lo
   * trae — el reporte fiscal prefiere un cero visible a un IVA supuesto.
   */
  private splitTax(
    amount: PrismaClient.Decimal,
    taxRate: PrismaClient.Decimal | null,
  ) {
    if (!taxRate || Number(taxRate) === 0) {
      return { subtotal: null, tax: null, creditable: 0 };
    }

    const total = new Decimal(amount);
    const subtotal = total
      .dividedBy(new Decimal(taxRate).dividedBy(100).plus(1))
      .toDP(2);
    const tax = total.minus(subtotal);

    return {
      subtotal: subtotal.toNumber(),
      tax: tax.toNumber(),
      creditable: tax.toNumber(),
    };
  }
}
