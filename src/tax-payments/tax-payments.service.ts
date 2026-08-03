import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CreateTaxPaymentDto,
  PayTaxPaymentDto,
  UpdateTaxPaymentDto,
  FilterTaxPaymentsDto,
  TaxEstimateQueryDto,
} from './dto/tax-payment.dto';
import {
  TaxPaymentEntity,
  TAX_PAYMENT_PUBLIC_SELECT,
} from './entities/tax-payment.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { Prisma, Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;

const ISR_ESTIMATE_PERCENTAGE = process.env.ISR_ESTIMATE_PERCENTAGE
  ? parseFloat(process.env.ISR_ESTIMATE_PERCENTAGE)
  : null;

@Injectable()
export class TaxPaymentsService {
  constructor(private prisma: PrismaService) {}

  async create(ctx: OwnershipContext, dto: CreateTaxPaymentDto) {
    this.validatePeriod(dto.fiscal_period_start, dto.fiscal_period_end);
    await this.validateAccount(ctx, dto.account_id);

    const status = dto.paid_at ? 'PAID' : 'PENDING';

    const payment = await this.prisma.taxPayment.create({
      data: {
        type: dto.type,
        tax_id: dto.tax_id ?? null,
        fiscal_period_start: new Date(dto.fiscal_period_start),
        fiscal_period_end: new Date(dto.fiscal_period_end),
        due_date: dto.due_date ? new Date(dto.due_date) : null,
        paid_at: dto.paid_at ? new Date(dto.paid_at) : null,
        amount: dto.amount,
        account_id: dto.account_id,
        status,
        notes: dto.notes ?? null,
        user_id: ctx.userId,
      },
      select: TAX_PAYMENT_PUBLIC_SELECT,
    });
    return new TaxPaymentEntity(payment);
  }

  async findAll(ctx: OwnershipContext, filters: FilterTaxPaymentsDto) {
    const where: Prisma.TaxPaymentWhereInput = { ...buildOwnerFilter(ctx) };

    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status as any;

    const dateField = filters.date_field || 'fiscal_period_start';
    if (filters.start_date) {
      (where as any)[dateField] = {
        ...((where as any)[dateField] || {}),
        gte: new Date(filters.start_date),
      };
    }
    if (filters.end_date) {
      (where as any)[dateField] = {
        ...((where as any)[dateField] || {}),
        lte: new Date(filters.end_date),
      };
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.taxPayment.findMany({
        where,
        select: TAX_PAYMENT_PUBLIC_SELECT,
        skip,
        take: limit,
        orderBy: { fiscal_period_start: 'desc' },
      }),
      this.prisma.taxPayment.count({ where }),
    ]);

    return {
      data: data.map((t) => new TaxPaymentEntity(t)),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const payment = await this.prisma.taxPayment.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      select: TAX_PAYMENT_PUBLIC_SELECT,
    });
    if (!payment) throw new NotFoundException('Tax payment not found');
    return new TaxPaymentEntity(payment);
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateTaxPaymentDto) {
    const existing = await this.prisma.taxPayment.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Tax payment not found');

    if (dto.fiscal_period_start || dto.fiscal_period_end) {
      this.validatePeriod(
        dto.fiscal_period_start ?? existing.fiscal_period_start.toISOString(),
        dto.fiscal_period_end ?? existing.fiscal_period_end.toISOString(),
      );
    }

    if (dto.account_id) {
      await this.validateAccount(ctx, dto.account_id);
    }

    const updateData: any = {};
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.tax_id !== undefined) updateData.tax_id = dto.tax_id;
    if (dto.fiscal_period_start !== undefined)
      updateData.fiscal_period_start = new Date(dto.fiscal_period_start);
    if (dto.fiscal_period_end !== undefined)
      updateData.fiscal_period_end = new Date(dto.fiscal_period_end);
    if (dto.due_date !== undefined)
      updateData.due_date = dto.due_date ? new Date(dto.due_date) : null;
    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.account_id !== undefined) updateData.account_id = dto.account_id;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const payment = await this.prisma.taxPayment.update({
      where: { id },
      data: updateData,
      select: TAX_PAYMENT_PUBLIC_SELECT,
    });
    return new TaxPaymentEntity(payment);
  }

  async remove(ctx: OwnershipContext, id: number) {
    const existing = await this.prisma.taxPayment.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Tax payment not found');

    if (existing.status === 'PAID') {
      throw new ConflictException(
        'Cannot delete a paid tax payment. Cancel it instead.',
      );
    }

    await this.prisma.taxPayment.delete({ where: { id } });
  }

  async pay(ctx: OwnershipContext, id: number, dto: PayTaxPaymentDto) {
    const existing = await this.prisma.taxPayment.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Tax payment not found');

    if (existing.status === 'PAID') {
      throw new ConflictException('Tax payment is already paid');
    }

    const account_id = dto.account_id ?? existing.account_id;
    const account = await this.prisma.account.findFirst({
      where: { id: account_id },
    });
    if (!account || !account.is_active) {
      throw new BadRequestException(
        'Cannot use an inactive account for payment',
      );
    }

    const paid_at = dto.paid_at ? new Date(dto.paid_at) : new Date();

    const payment = await this.prisma.taxPayment.update({
      where: { id },
      data: {
        status: 'PAID',
        paid_at,
        account_id,
      },
      select: TAX_PAYMENT_PUBLIC_SELECT,
    });
    return new TaxPaymentEntity(payment);
  }

  async estimate(ctx: OwnershipContext, query: TaxEstimateQueryDto) {
    const startDate = new Date(query.start_date);
    const endDate = new Date(query.end_date);
    const ownerFilter = buildOwnerFilter(ctx);

    const invoicedIncomesAgg = await this.prisma.income.aggregate({
      where: {
        ...ownerFilter,
        invoiced: true,
        date: { gte: startDate, lte: endDate },
      },
      _sum: { net_amount: true },
    });

    const ivaCreditableAgg = await this.prisma.expense.aggregate({
      where: {
        ...ownerFilter,
        invoice_status: 'INVOICED',
        is_tax_deductible: true,
        date: { gte: startDate, lte: endDate },
      },
      _sum: { tax_creditable_amount: true },
    });

    const ivaRateResult = await this.prisma.tax.findFirst({
      where: { name: { contains: 'IVA' } },
      select: { rate: true },
    });
    const ivaRate = ivaRateResult ? ivaRateResult.rate / 100 : 0.16;

    const netAmount = Number(invoicedIncomesAgg._sum?.net_amount ?? 0);
    const ivaCharged = netAmount * ivaRate;
    const ivaCreditable = Number(
      ivaCreditableAgg._sum?.tax_creditable_amount ?? 0,
    );
    const ivaDifference = new Decimal(ivaCharged)
      .minus(new Decimal(ivaCreditable))
      .toNumber();

    let ivaInFavor = 0;
    let ivaToPay = 0;
    if (ivaDifference < 0) {
      ivaInFavor = Math.abs(ivaDifference);
    } else {
      ivaToPay = ivaDifference;
    }

    let isr: number | null = null;
    const percentage = query.isr_percentage ?? ISR_ESTIMATE_PERCENTAGE;
    if (percentage !== null) {
      const result = await this.getProfitBeforeTaxes(
        ctx,
        startDate,
        endDate,
        ownerFilter,
      );
      if (result > 0) {
        isr = new Decimal(result)
          .times(new Decimal(percentage))
          .dividedBy(100)
          .toNumber();
      } else {
        isr = 0;
      }
    }

    return {
      period: { start: startDate, end: endDate },
      iva_charged: ivaCharged,
      iva_creditable: ivaCreditable,
      iva_to_pay: ivaToPay,
      iva_in_favor: ivaInFavor,
      isr_estimated: isr,
      isr_percentage_used: percentage,
    };
  }

  private async getProfitBeforeTaxes(
    ctx: OwnershipContext,
    startDate: Date,
    endDate: Date,
    ownerFilter: { user_id?: number },
  ): Promise<number> {
    const incomesAgg = await this.prisma.income.aggregate({
      where: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
      _sum: { net_amount: true },
    });
    const expensesAgg = await this.prisma.expense.aggregate({
      where: {
        ...ownerFilter,
        paid_at: { gte: startDate, lte: endDate },
        status: 'PAID',
      },
      _sum: { amount: true },
    });

    const netIncomes = Number(incomesAgg._sum?.net_amount ?? 0);
    const expenses = Number(expensesAgg._sum?.amount ?? 0);
    return netIncomes - expenses;
  }

  private validatePeriod(start: string, end: string) {
    if (new Date(start) >= new Date(end)) {
      throw new BadRequestException(
        'fiscal_period_start must be before fiscal_period_end',
      );
    }
  }

  private async validateAccount(ctx: OwnershipContext, accountId: number) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, ...buildOwnerFilter(ctx) },
    });
    if (!account) throw new BadRequestException('Account not found');
    if (!account.is_active)
      throw new BadRequestException('Cannot use an inactive account');
  }
}
