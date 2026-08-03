import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { ReportsAggregationService } from '../reports/reports-aggregation.service';
import { ProfitEngine } from '../reports/profit-engine.service';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;

const FINGERPRINT_VERSION = 1;

@Injectable()
export class MonthlyCloseService {
  constructor(
    private prisma: PrismaService,
    private aggregation: ReportsAggregationService,
    private engine: ProfitEngine,
  ) {}

  async findAll(ctx: OwnershipContext, filters: any) {
    const where: any = { ...buildOwnerFilter(ctx) };
    const page = filters.page || 1; const limit = filters.limit || 24;
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.monthlyClose.findMany({ where, skip, take: limit, orderBy: { year: 'desc' }, select: { id: true, year: true, month: true, status: true, net_profit: true, closed_at: true } }),
      this.prisma.monthlyClose.count({ where }),
    ]);
    return { data: data.map((c: any) => ({ ...c, net_profit: Number(c.net_profit) })), total, page, limit };
  }

  async findOne(ctx: OwnershipContext, year: number, month: number) {
    const close = await this.prisma.monthlyClose.findUnique({
      where: { user_id_year_month: { user_id: ctx.userId, year, month } },
    });
    if (!close) {
      return { year, month, status: 'OPEN' };
    }
    return { ...close, income_total: Number(close.income_total), expense_total: Number(close.expense_total), cogs_total: Number(close.cogs_total), payroll_total: Number(close.payroll_total), tax_total: Number(close.tax_total), net_profit: Number(close.net_profit), cash_available: Number(close.cash_available) };
  }

  async preflight(ctx: OwnershipContext, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const ownerFilter = buildOwnerFilter(ctx);

    const [pendingExpenses, pendingPayroll, pendingTaxes, salesWithoutCost] = await Promise.all([
      this.prisma.expense.count({ where: { ...ownerFilter, status: 'PENDING', date: { gte: startDate, lte: endDate } } }),
      this.prisma.payrollPayment.count({ where: { employee: { ...ownerFilter }, status: { in: ['PENDING', 'SCHEDULED'] }, scheduled_pay_date: { gte: startDate, lte: endDate } } }),
      this.prisma.taxPayment.count({ where: { ...ownerFilter, status: 'PENDING', fiscal_period_start: { gte: startDate, lte: endDate } } }),
      this.prisma.income.count({ where: { ...ownerFilter, date: { gte: startDate, lte: endDate }, cogs_total: null } }),
    ]);

    const prevClose = await this.prisma.monthlyClose.findUnique({
      where: { user_id_year_month: { user_id: ctx.userId, year: month === 1 ? year - 1 : year, month: month === 1 ? 12 : month - 1 } },
    });

    const warnings: string[] = [];
    if (pendingExpenses > 0) warnings.push(`${pendingExpenses} pending expenses`);
    if (pendingPayroll > 0) warnings.push(`${pendingPayroll} pending payroll payments`);
    if (pendingTaxes > 0) warnings.push(`${pendingTaxes} pending tax payments`);
    if (salesWithoutCost > 0) warnings.push(`${salesWithoutCost} sales without cost`);

    const blocking_issues: string[] = [];
    if (month > 1 || year > (new Date().getFullYear() - 1)) {
      const prevOpen = prevClose && prevClose.status === 'CLOSED' ? false : true;
      if (prevOpen && prevClose === null) {
        // first month of history - no prior close exists, skip
      } else if (prevOpen && prevClose?.status !== 'CLOSED') {
        blocking_issues.push(`Previous month (${prevClose?.year ?? year}-${prevClose?.month ?? month - 1}) is not closed`);
      }
    }
    if (month === new Date().getMonth() + 1 && year === new Date().getFullYear()) {
      blocking_issues.push('Cannot close current or future month');
    }

    let integrity: any = null;
    if (prevClose?.status === 'CLOSED') {
      integrity = await this.checkIntegrity(ctx, prevClose.year, prevClose.month);
      if (integrity?.status === 'DIVERGED') {
        blocking_issues.push(`Previous month integrity check failed: ${integrity.detail}`);
      }
    }

    return {
      year, month,
      warnings,
      blocking_issues,
      can_close: blocking_issues.length === 0,
      pending: { pending_expenses: pendingExpenses, pending_payroll: pendingPayroll, pending_taxes: pendingTaxes, sales_without_cost: salesWithoutCost },
      previous_month_integrity: integrity,
    };
  }

  async close(ctx: OwnershipContext, year: number, month: number, userId: number) {
    const pre = await this.preflight(ctx, year, month);
    if (!pre.can_close) throw new ConflictException(`Cannot close: ${pre.blocking_issues.join(', ')}`);

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const aggregates = await this.aggregation.getMonthlyAggregates(ctx, startDate, endDate);
    const report = this.engine.calculate(aggregates);

    const fingerprint = await this.computeFingerprint(ctx, startDate, endDate);

    await this.prisma.monthlyClose.upsert({
      where: { user_id_year_month: { user_id: ctx.userId, year, month } },
      create: {
        year, month, status: 'CLOSED', user_id: ctx.userId,
        income_total: report.net_sales, expense_total: report.calculated_operating_expenses,
        cogs_total: report.cogs ?? 0, payroll_total: report.payroll_paid, tax_total: report.taxes_paid,
        net_profit: report.net_profit ?? 0, cash_available: 0,
        source_fingerprint: fingerprint, fingerprint_version: FINGERPRINT_VERSION,
        closed_at: new Date(), closed_by_user_id: userId,
      },
      update: {
        status: 'CLOSED',
        income_total: report.net_sales, expense_total: report.calculated_operating_expenses,
        cogs_total: report.cogs ?? 0, payroll_total: report.payroll_paid, tax_total: report.taxes_paid,
        net_profit: report.net_profit ?? 0, cash_available: 0,
        source_fingerprint: fingerprint, fingerprint_version: FINGERPRINT_VERSION,
        closed_at: new Date(), closed_by_user_id: userId, reopened_reason: null,
      },
    });

    return { status: 'CLOSED', year, month };
  }

  async reopen(ctx: OwnershipContext, year: number, month: number, reason: string, userId: number) {
    if (!reason) throw new BadRequestException('Reopen reason is required');
    const close = await this.prisma.monthlyClose.findUnique({ where: { user_id_year_month: { user_id: ctx.userId, year, month } } });
    if (!close || close.status !== 'CLOSED') throw new ConflictException('Month is not closed');

    await this.prisma.monthlyClose.update({
      where: { user_id_year_month: { user_id: ctx.userId, year, month } },
      data: { status: 'OPEN', reopened_reason: reason },
    });

    // Cascade: reopen all subsequent closed months
    const subsequent = await this.prisma.monthlyClose.findMany({
      where: { user_id: ctx.userId, status: 'CLOSED', OR: [{ year: { gt: year } }, { year: { equals: year }, month: { gt: month } }] },
    });
    for (const s of subsequent) {
      await this.prisma.monthlyClose.update({
        where: { id: s.id },
        data: { status: 'OPEN', reopened_reason: `Cascade: month ${year}-${month} was reopened` },
      });
    }

    return { status: 'OPEN', year, month, cascaded: subsequent.length };
  }

  async checkIntegrity(ctx: OwnershipContext, year: number, month: number) {
    const close = await this.prisma.monthlyClose.findUnique({ where: { user_id_year_month: { user_id: ctx.userId, year, month } } });
    if (!close || close.status !== 'CLOSED') return { status: 'NOT_CLOSED', year, month };

    if (!close.source_fingerprint || close.fingerprint_version !== FINGERPRINT_VERSION) {
      return { status: 'UNKNOWN_FINGERPRINT_VERSION', year, month };
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const current = await this.computeFingerprint(ctx, startDate, endDate);

    const stored = close.source_fingerprint as any;
    const tables = ['expenses', 'incomes', 'payroll_payments', 'tax_payments', 'cost_of_goods_sold'];
    for (const table of tables) {
      if (JSON.stringify(stored[table]) !== JSON.stringify(current[table])) {
        return { status: 'DIVERGED', year, month, detail: `Table '${table}' changed`, stored: stored[table], current: current[table] };
      }
    }

    return { status: 'OK', year, month };
  }

  async review(ctx: OwnershipContext, year: number, month: number) {
    return this.prisma.monthlyClose.upsert({
      where: { user_id_year_month: { user_id: ctx.userId, year, month } },
      create: { year, month, status: 'REVIEWING', user_id: ctx.userId },
      update: { status: 'REVIEWING' },
    });
  }

  private async computeFingerprint(ctx: OwnershipContext, startDate: Date, endDate: Date) {
    const of = buildOwnerFilter(ctx);
    const expenses = await this.prisma.expense.aggregate({ where: { ...of, date: { gte: startDate, lte: endDate } }, _sum: { amount: true }, _count: true });
    const incomes = await this.prisma.income.aggregate({ where: { ...of, date: { gte: startDate, lte: endDate } }, _sum: { amount: true }, _count: true });
    const payroll = await this.prisma.payrollPayment.aggregate({ where: { employee: { ...of }, paid_at: { gte: startDate, lte: endDate } }, _sum: { net_amount: true }, _count: true });
    const taxes = await this.prisma.taxPayment.aggregate({ where: { ...of, paid_at: { gte: startDate, lte: endDate } }, _sum: { amount: true }, _count: true });
    const cogs = await this.prisma.costOfGoodsSold.aggregate({ where: { income: { ...of, date: { gte: startDate, lte: endDate } } }, _sum: { total_cost: true }, _count: true });

    return {
      expenses: { count: expenses._count, sum: expenses._sum.amount?.toString() ?? '0' },
      incomes: { count: incomes._count, sum: incomes._sum.amount?.toString() ?? '0' },
      payroll_payments: { count: payroll._count, sum: payroll._sum.net_amount?.toString() ?? '0' },
      tax_payments: { count: taxes._count, sum: taxes._sum.amount?.toString() ?? '0' },
      cost_of_goods_sold: { count: cogs._count, sum: cogs._sum.total_cost?.toString() ?? '0' },
    };
  }
}
