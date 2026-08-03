import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ProfitEngine } from './profit-engine.service';
import { OwnershipContext } from '../common/ownership';

@Injectable()
export class ComparisonService {
  constructor(private prisma: PrismaService, private aggregation: ReportsAggregationService, private engine: ProfitEngine) {}

  async compare(ctx: OwnershipContext, periods: string[]) {
    if (periods.length < 2 || periods.length > 12) throw new Error('Periods must be between 2 and 12');
    const results = [];
    let hasMixedSources = false;
    let prev: any = null;

    for (const period of periods) {
      const [y, m] = period.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1);
      const endDate = new Date(y, m, 0, 23, 59, 59);

      const snapshot = await this.prisma.monthlyClose.findUnique({
        where: { user_id_year_month: { user_id: ctx.userId, year: y, month: m } },
      });

      let report: any;
      let source: string;

      if (snapshot?.status === 'CLOSED') {
        report = {
          net_sales: Number(snapshot.income_total),
          cogs: Number(snapshot.cogs_total),
          gross_profit: Number(snapshot.income_total) - Number(snapshot.cogs_total),
          operating_expenses: Number(snapshot.expense_total),
          payroll_paid: Number(snapshot.payroll_total),
          calculated_operating_expenses: Number(snapshot.expense_total),
          operating_profit: Number(snapshot.income_total) - Number(snapshot.cogs_total) - Number(snapshot.expense_total),
          taxes_paid: Number(snapshot.tax_total),
          net_profit: Number(snapshot.net_profit),
        };
        source = 'SNAPSHOT';
      } else {
        const aggregates = await this.aggregation.getMonthlyAggregates(ctx, startDate, endDate);
        report = this.engine.calculate(aggregates);
        source = 'DYNAMIC';
      }

      let variation_abs: any = null;
      let variation_pct: any = null;

      if (prev) {
        variation_abs = {};
        variation_pct = {};
        for (const key of ['net_sales', 'gross_profit', 'net_profit'] as const) {
          variation_abs[key] = Math.round(((report[key] ?? 0) - (prev.report[key] ?? 0)) * 100) / 100;
          variation_pct[key] = prev.report[key] !== 0 ? Math.round(((report[key] ?? 0) - (prev.report[key] ?? 0)) / prev.report[key] * 100 * 100) / 100 : null;
        }
      }

      const entry = { period, source, report, variation_abs, variation_pct };
      if (source === 'SNAPSHOT') hasMixedSources = true;
      results.push(entry);
      prev = entry;
    }

    if (results.length > 0 && !hasMixedSources) {
      hasMixedSources = results.some((r) => r.source === 'DYNAMIC') && results.some((r) => r.source === 'SNAPSHOT');
    }

    return { periods: results, has_mixed_sources: hasMixedSources };
  }

  async trends(ctx: OwnershipContext, months: number) {
    if (months < 2 || months > 36) throw new Error('Months must be between 2 and 36');
    const results = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const startDate = new Date(y, m - 1, 1);
      const endDate = new Date(y, m, 0, 23, 59, 59);
      const period = `${y}-${String(m).padStart(2, '0')}`;

      const snapshot = await this.prisma.monthlyClose.findUnique({
        where: { user_id_year_month: { user_id: ctx.userId, year: y, month: m } },
      });

      let report: any;
      if (snapshot?.status === 'CLOSED') {
        report = {
          net_sales: Number(snapshot.income_total),
          gross_profit: Number(snapshot.income_total) - Number(snapshot.cogs_total),
          operating_profit: Number(snapshot.income_total) - Number(snapshot.cogs_total) - Number(snapshot.expense_total),
          net_profit: Number(snapshot.net_profit),
          gross_margin: Number(snapshot.income_total) > 0 ? Math.round((Number(snapshot.income_total) - Number(snapshot.cogs_total)) / Number(snapshot.income_total) * 100 * 100) / 100 : null,
          net_margin: Number(snapshot.income_total) > 0 ? Math.round(Number(snapshot.net_profit) / Number(snapshot.income_total) * 100 * 100) / 100 : null,
        };
      } else {
        const aggregates = await this.aggregation.getMonthlyAggregates(ctx, startDate, endDate);
        const r = this.engine.calculate(aggregates);
        report = {
          net_sales: r.net_sales,
          gross_profit: r.gross_profit ?? 0,
          operating_profit: r.operating_profit ?? 0,
          net_profit: r.net_profit ?? 0,
          gross_margin: r.gross_margin,
          net_margin: r.net_margin,
        };
      }

      results.push({ period, ...report });
    }

    return { periods: results };
  }
}
