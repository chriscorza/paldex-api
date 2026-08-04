import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReportAggregates } from './profit-engine.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;

@Injectable()
export class ReportsAggregationService {
  constructor(private prisma: PrismaService) {}

  async getMonthlyAggregates(
    ctx: OwnershipContext,
    startDate: Date,
    endDate: Date,
  ): Promise<ReportAggregates> {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const [
      incomeAgg,
      incomeCounts,
      cogsAgg,
      ,
      payrollPaidAgg,
      payrollPendingAgg,
      taxesPaidAgg,
      taxesPendingAgg,
    ] = await Promise.all([
      this.prisma.income.aggregate({
        where: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
        _sum: {
          amount: true,
          net_amount: true,
          gross_amount: true,
          discount_total: true,
          fee_total: true,
          shipping_charged: true,
          shipping_cost: true,
          cogs_total: true,
        },
        _count: { id: true },
      }),
      this.prisma.income.findMany({
        where: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
        select: { id: true, _count: { select: { cogs: true } } },
      }),
      this.prisma.costOfGoodsSold.aggregate({
        where: {
          income: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
        },
        _sum: { total_cost: true },
      }),
      this.prisma.expenseCategory.findMany({
        where: { OR: [{ user_id: ctx.userId }, { is_system: true }] },
        select: {
          type: true,
          name: true,
          affects_operating_profit: true,
          is_cash_outflow: true,
          _count: {
            select: {
              expenses: {
                where: {
                  ...ownerFilter,
                  paid_at: { gte: startDate, lte: endDate },
                  status: 'PAID',
                },
              },
            },
          },
        },
      }),
      this.prisma.payrollPayment.aggregate({
        where: {
          employee: { ...ownerFilter },
          paid_at: { gte: startDate, lte: endDate },
          status: 'PAID',
        },
        _sum: { net_amount: true },
      }),
      this.prisma.payrollPayment.aggregate({
        where: {
          employee: { ...ownerFilter },
          scheduled_pay_date: { gte: startDate, lte: endDate },
          status: { in: ['PENDING', 'SCHEDULED'] },
        },
        _sum: { net_amount: true },
      }),
      this.prisma.taxPayment.aggregate({
        where: { ...ownerFilter, paid_at: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
      }),
      this.prisma.taxPayment.aggregate({
        where: {
          ...ownerFilter,
          paid_at: null,
          fiscal_period_start: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
    ]);

    const cogsConfirmedCount = incomeCounts.filter(
      (i: any) => i._count?.cogs > 0,
    ).length;

    return {
      net_sales: incomeAgg._sum.net_amount ?? new Decimal(0),
      gross_sales: incomeAgg._sum.gross_amount ?? new Decimal(0),
      discounts_total: incomeAgg._sum.discount_total ?? new Decimal(0),
      fees_total: incomeAgg._sum.fee_total ?? new Decimal(0),
      shipping_charged: incomeAgg._sum.shipping_charged ?? new Decimal(0),
      shipping_cost: incomeAgg._sum.shipping_cost ?? new Decimal(0),

      cogs: cogsAgg._sum.total_cost ?? new Decimal(0),
      cogs_confirmed_sales_count: cogsConfirmedCount,
      total_sales_count: incomeAgg._count.id,

      operating_expenses: new Decimal(0),
      payroll_paid: payrollPaidAgg._sum.net_amount ?? new Decimal(0),
      taxes_paid: taxesPaidAgg._sum.amount ?? new Decimal(0),
      inventory_purchases: new Decimal(0),
      owner_withdrawals: new Decimal(0),
      reinvestment: new Decimal(0),
      debt_principal_paid: new Decimal(0),

      pending_expenses: new Decimal(0),
      pending_payroll: payrollPendingAgg._sum.net_amount ?? new Decimal(0),
      pending_taxes: taxesPendingAgg._sum.amount ?? new Decimal(0),
    };
  }

  async getExpensesBreakdown(
    ctx: OwnershipContext,
    startDate: Date,
    endDate: Date,
    prevStartDate: Date,
    prevEndDate: Date,
  ) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const currentExpenses = await this.prisma.expense.groupBy({
      by: ['category_id'],
      where: {
        ...ownerFilter,
        paid_at: { gte: startDate, lte: endDate },
        status: 'PAID',
      },
      _sum: { amount: true },
    });

    const previousExpenses = await this.prisma.expense.groupBy({
      by: ['category_id'],
      where: {
        ...ownerFilter,
        paid_at: { gte: prevStartDate, lte: prevEndDate },
        status: 'PAID',
      },
      _sum: { amount: true },
    });

    const categories = await this.prisma.expenseCategory.findMany({
      where: { OR: [{ user_id: ctx.userId }, { is_system: true }] },
      select: { id: true, name: true, type: true },
    });

    const netSalesAgg = await this.prisma.income.aggregate({
      where: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
      _sum: { net_amount: true },
    });

    const netSales = Number(netSalesAgg._sum.net_amount ?? 0);

    const byCategory = categories.map((cat) => {
      const curr = currentExpenses.find((e) => e.category_id === cat.id);
      const prev = previousExpenses.find((e) => e.category_id === cat.id);
      const currentAmount = Number(curr?._sum?.amount ?? 0);
      const previousAmount = Number(prev?._sum?.amount ?? 0);
      const variation =
        previousAmount > 0
          ? ((currentAmount - previousAmount) / previousAmount) * 100
          : currentAmount > 0
            ? 100
            : 0;

      return {
        category_id: cat.id,
        name: cat.name,
        type: cat.type,
        amount: currentAmount,
        previous_amount: previousAmount,
        variation_pct: Math.round(variation * 100) / 100,
        pct_of_net_sales:
          netSales > 0
            ? Math.round((currentAmount / netSales) * 100 * 100) / 100
            : 0,
      };
    });

    const byType: Record<
      string,
      { type: string; amount: number; previous_amount: number }
    > = {};
    for (const row of byCategory) {
      if (!byType[row.type])
        byType[row.type] = { type: row.type, amount: 0, previous_amount: 0 };
      byType[row.type].amount += row.amount;
      byType[row.type].previous_amount += row.previous_amount;
    }

    return {
      by_type: Object.values(byType),
      by_category: byCategory,
      net_sales: netSales,
    };
  }

  async getFiscalReport(ctx: OwnershipContext, startDate: Date, endDate: Date) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const [invoicedAgg, pendingAgg, notInvoicedAgg, notDeductibleAgg] =
      await Promise.all([
        this.prisma.expense.aggregate({
          where: {
            ...ownerFilter,
            paid_at: { gte: startDate, lte: endDate },
            status: 'PAID',
            invoice_status: 'INVOICED',
          },
          _sum: { amount: true, tax_amount: true, tax_creditable_amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            ...ownerFilter,
            paid_at: { gte: startDate, lte: endDate },
            status: 'PAID',
            invoice_status: 'PENDING_INVOICE',
          },
          _sum: { amount: true, tax_amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            ...ownerFilter,
            paid_at: { gte: startDate, lte: endDate },
            status: 'PAID',
            invoice_status: { in: ['NOT_INVOICED', 'NOT_DEDUCTIBLE'] },
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            ...ownerFilter,
            paid_at: { gte: startDate, lte: endDate },
            status: 'PAID',
          },
          _sum: { amount: true },
        }),
      ]);

    const totalPaid = Number(notDeductibleAgg._sum?.amount ?? 0);

    return {
      total_expenses_paid: totalPaid,
      invoiced: {
        amount: Number(invoicedAgg._sum?.amount ?? 0),
        tax_amount: Number(invoicedAgg._sum?.tax_amount ?? 0),
        iva_creditable: Number(invoicedAgg._sum?.tax_creditable_amount ?? 0),
      },
      pending_invoice: {
        amount: Number(pendingAgg._sum?.amount ?? 0),
        potential_iva_creditable: Number(pendingAgg._sum?.tax_amount ?? 0),
      },
      not_invoiced_or_not_deductible: {
        amount: Number(notInvoicedAgg._sum?.amount ?? 0),
      },
    };
  }

  async getPayrollReport(
    ctx: OwnershipContext,
    startDate: Date,
    endDate: Date,
  ) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const [paidAgg, pendingAgg, byEmployee, deferredAgg] = await Promise.all([
      this.prisma.payrollPayment.aggregate({
        where: {
          employee: { ...ownerFilter },
          paid_at: { gte: startDate, lte: endDate },
          status: 'PAID',
        },
        _sum: { net_amount: true, gross_amount: true, bonuses: true },
      }),
      this.prisma.payrollPayment.aggregate({
        where: {
          employee: { ...ownerFilter },
          scheduled_pay_date: { gte: startDate, lte: endDate },
          status: { in: ['PENDING', 'SCHEDULED'] },
        },
        _sum: { net_amount: true },
      }),
      this.prisma.payrollPayment.groupBy({
        by: ['employee_id'],
        where: {
          employee: { ...ownerFilter },
          paid_at: { gte: startDate, lte: endDate },
          status: 'PAID',
        },
        _sum: { net_amount: true },
      }),
      this.prisma.payrollPayment.findMany({
        where: {
          employee: { ...ownerFilter },
          scheduled_pay_date: { lt: startDate },
          paid_at: { gte: startDate, lte: endDate },
          status: 'PAID',
        },
        select: {
          employee_id: true,
          net_amount: true,
          scheduled_pay_date: true,
          paid_at: true,
        },
      }),
    ]);

    const employees = await this.prisma.employee.findMany({
      where: { ...ownerFilter },
      select: { id: true, name: true },
    });

    const netSalesAgg = await this.prisma.income.aggregate({
      where: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
      _sum: { net_amount: true },
    });
    const netSales = Number(netSalesAgg._sum.net_amount ?? 0);
    const totalPaid = Number(paidAgg._sum?.net_amount ?? 0);

    return {
      payroll_paid: totalPaid,
      base_salary_paid: Number(paidAgg._sum?.gross_amount ?? 0),
      bonuses_paid: Number(paidAgg._sum?.bonuses ?? 0),
      payroll_ratio:
        netSales > 0 ? Math.round((totalPaid / netSales) * 100 * 100) / 100 : 0,
      pending_payroll: Number(pendingAgg._sum?.net_amount ?? 0),
      by_employee: employees.map((emp) => {
        const agg = byEmployee.find((e) => e.employee_id === emp.id);
        return {
          employee_id: emp.id,
          name: emp.name,
          paid_amount: Number(agg?._sum?.net_amount ?? 0),
        };
      }),
      deferred_payments: deferredAgg.map((d) => ({
        employee_id: d.employee_id,
        net_amount: Number(d.net_amount),
        scheduled_pay_date: d.scheduled_pay_date,
        paid_at: d.paid_at,
      })),
    };
  }

  async getCashReport(ctx: OwnershipContext) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const accounts = await this.prisma.account.findMany({
      where: { ...ownerFilter },
      select: {
        id: true,
        name: true,
        balance: true,
        initial_balance: true,
        is_active: true,
      },
    });

    const result = await Promise.all(
      accounts.map(async (account) => {
        const [incomeSum, expenseSum, payrollSum, taxPaymentsSum] =
          await Promise.all([
            this.prisma.income.aggregate({
              where: { ...ownerFilter, account_id: account.id },
              _sum: { net_amount: true },
            }),
            this.prisma.expense.aggregate({
              where: { ...ownerFilter, account_id: account.id, status: 'PAID' },
              _sum: { amount: true },
            }),
            this.prisma.payrollPayment.aggregate({
              where: {
                employee: { ...ownerFilter },
                account_id: account.id,
                status: 'PAID',
              },
              _sum: { net_amount: true },
            }),
            this.prisma.taxPayment.aggregate({
              where: { ...ownerFilter, account_id: account.id, status: 'PAID' },
              _sum: { amount: true },
            }),
          ]);

        const initial = Number(account.initial_balance);
        const incomes = Number(incomeSum._sum?.net_amount ?? 0);
        const expenses = Number(expenseSum._sum?.amount ?? 0);
        const payroll = Number(payrollSum._sum?.net_amount ?? 0);
        const taxes = Number(taxPaymentsSum._sum?.amount ?? 0);

        const computed = initial + incomes - expenses - payroll - taxes;
        const stored = Number(account.balance);
        const drift = Math.round((stored - computed) * 100) / 100;

        return {
          account_id: account.id,
          name: account.name,
          is_active: account.is_active,
          computed_balance: computed,
          stored_balance: stored,
          drift,
        };
      }),
    );

    const activeAccounts = result.filter((a) => a.is_active);
    const pendingPayrollAgg = await this.prisma.payrollPayment.aggregate({
      where: {
        employee: { ...ownerFilter },
        status: { in: ['PENDING', 'SCHEDULED'] },
      },
      _sum: { net_amount: true },
    });
    const pendingTaxesAgg = await this.prisma.taxPayment.aggregate({
      where: { ...ownerFilter, status: 'PENDING' },
      _sum: { amount: true },
    });

    const totalComputed = activeAccounts.reduce(
      (sum, a) => sum + a.computed_balance,
      0,
    );
    const pendingPayroll = Number(pendingPayrollAgg._sum?.net_amount ?? 0);
    const pendingTaxes = Number(pendingTaxesAgg._sum?.amount ?? 0);

    return {
      accounts: result,
      available_cash: totalComputed - pendingPayroll - pendingTaxes,
      pending_deductions: {
        payroll: pendingPayroll,
        taxes: pendingTaxes,
      },
      excluded_liabilities: ['accounts_payable'],
    };
  }

  async getSalesWithoutCost(
    ctx: OwnershipContext,
    startDate: Date,
    endDate: Date,
  ) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const incomes = await this.prisma.income.findMany({
      where: {
        ...ownerFilter,
        date: { gte: startDate, lte: endDate },
        cogs_total: null,
      },
      select: {
        id: true,
        concept: true,
        date: true,
        net_amount: true,
        amount: true,
      },
      orderBy: { date: 'desc' },
    });

    const totalPending = incomes.reduce(
      (sum, i) => sum + Number(i.net_amount ?? i.amount),
      0,
    );

    return {
      sales: incomes,
      total_pending_to_cost: totalPending,
      count: incomes.length,
    };
  }
}
