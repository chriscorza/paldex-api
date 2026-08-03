import { Prisma } from '@prisma/client';
const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

import { roundToCents, percentage } from '../common/money';

export interface ReportAggregates {
  net_sales: Decimal | number;
  gross_sales: Decimal | number;
  discounts_total: Decimal | number;
  fees_total: Decimal | number;
  shipping_charged: Decimal | number;
  shipping_cost: Decimal | number;

  cogs: Decimal | number | null;
  cogs_confirmed_sales_count: number;
  total_sales_count: number;

  operating_expenses: Decimal | number;
  payroll_paid: Decimal | number;
  taxes_paid: Decimal | number;
  inventory_purchases: Decimal | number;
  owner_withdrawals: Decimal | number;
  reinvestment: Decimal | number;
  debt_principal_paid: Decimal | number;

  pending_expenses: Decimal | number;
  pending_payroll: Decimal | number;
  pending_taxes: Decimal | number;
}

export interface ProfitReport {
  net_sales: number;
  gross_sales: number;
  discounts_total: number;
  fees_total: number;
  shipping_charged: number;
  shipping_cost: number;

  cogs: number | null;
  gross_profit: number | null;
  gross_margin: number | null;

  operating_expenses: number;
  payroll_paid: number;
  calculated_operating_expenses: number;
  operating_profit: number | null;
  operating_margin: number | null;

  taxes_paid: number;
  net_profit: number | null;
  net_margin: number | null;

  inventory_purchases: number;
  owner_withdrawals: number;
  reinvestment: number;
  debt_principal_paid: number;

  quality: DataQuality;
  projection: ProjectionBlock;
}

export interface DataQuality {
  sales_without_cost: number;
  cost_data_coverage: number | null;
  gross_profit_confirmed: number | null;
  gross_profit_purchase_basis: number | null;
  incomplete_cost_data: boolean;
}

export interface ProjectionBlock {
  pending_expenses: number;
  pending_payroll: number;
  pending_taxes: number;
  projected_net_profit: number | null;
}

export class ProfitEngine {
  calculate(aggregates: ReportAggregates): ProfitReport {
    const s = this.toNum;
    const netSales = s(aggregates.net_sales);

    const cogsNum =
      aggregates.cogs !== null && aggregates.cogs !== undefined
        ? s(aggregates.cogs)
        : null;

    const grossProfit =
      cogsNum !== null ? roundToCents(netSales - cogsNum) : null;
    const grossMargin =
      grossProfit !== null && netSales > 0
        ? percentage(grossProfit, netSales)
        : null;

    const payrollPaid = s(aggregates.payroll_paid);
    const operatingExpenses = s(aggregates.operating_expenses);
    const calculatedOperatingExpenses = roundToCents(
      operatingExpenses + payrollPaid,
    );

    const operatingProfit =
      grossProfit !== null
        ? roundToCents(grossProfit - calculatedOperatingExpenses)
        : null;

    const operatingMargin =
      operatingProfit !== null && netSales > 0
        ? percentage(operatingProfit, netSales)
        : null;

    const taxesPaid = s(aggregates.taxes_paid);

    const netProfit =
      operatingProfit !== null
        ? roundToCents(operatingProfit - taxesPaid)
        : null;

    const netMargin =
      netProfit !== null && netSales > 0
        ? percentage(netProfit, netSales)
        : null;

    const salesWithoutCost =
      aggregates.total_sales_count - aggregates.cogs_confirmed_sales_count;
    const costDataCoverage =
      aggregates.total_sales_count > 0
        ? percentage(
            aggregates.cogs_confirmed_sales_count,
            aggregates.total_sales_count,
          )
        : null;

    const grossProfitConfirmed = cogsNum !== null ? grossProfit : null;

    const inventoryPurchasesPaid = s(aggregates.inventory_purchases);
    const grossProfitPurchaseBasis = roundToCents(
      netSales - inventoryPurchasesPaid,
    );

    const pendingExpenses = s(aggregates.pending_expenses);
    const pendingPayroll = s(aggregates.pending_payroll);
    const pendingTaxes = s(aggregates.pending_taxes);

    const projectedNetProfit =
      netProfit !== null
        ? roundToCents(
            netProfit - pendingExpenses - pendingPayroll - pendingTaxes,
          )
        : null;

    return {
      net_sales: netSales,
      gross_sales: s(aggregates.gross_sales),
      discounts_total: s(aggregates.discounts_total),
      fees_total: s(aggregates.fees_total),
      shipping_charged: s(aggregates.shipping_charged),
      shipping_cost: s(aggregates.shipping_cost),

      cogs: cogsNum !== null ? roundToCents(cogsNum) : null,
      gross_profit: grossProfit,
      gross_margin: grossMargin,

      operating_expenses: s(aggregates.operating_expenses),
      payroll_paid: payrollPaid,
      calculated_operating_expenses: calculatedOperatingExpenses,
      operating_profit: operatingProfit,
      operating_margin: operatingMargin,

      taxes_paid: taxesPaid,
      net_profit: netProfit,
      net_margin: netMargin,

      inventory_purchases: inventoryPurchasesPaid,
      owner_withdrawals: s(aggregates.owner_withdrawals),
      reinvestment: s(aggregates.reinvestment),
      debt_principal_paid: s(aggregates.debt_principal_paid),

      quality: {
        sales_without_cost: Math.max(0, salesWithoutCost),
        cost_data_coverage: costDataCoverage,
        gross_profit_confirmed: grossProfitConfirmed,
        gross_profit_purchase_basis: grossProfitPurchaseBasis,
        incomplete_cost_data:
          costDataCoverage !== null && costDataCoverage < 100,
      },

      projection: {
        pending_expenses: pendingExpenses,
        pending_payroll: pendingPayroll,
        pending_taxes: pendingTaxes,
        projected_net_profit: projectedNetProfit,
      },
    };
  }

  private toNum(d: Decimal | number | null | undefined): number {
    if (d === null || d === undefined) return 0;
    if (d instanceof Decimal) return d.toNumber();
    return d;
  }
}
