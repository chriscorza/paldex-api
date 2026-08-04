import { ProfitEngine } from './profit-engine.service';
import type { ReportAggregates } from './profit-engine.service';

describe('ProfitEngine', () => {
  let engine: ProfitEngine;

  beforeEach(() => {
    engine = new ProfitEngine();
  });

  function makeAggregates(
    overrides: Partial<ReportAggregates> = {},
  ): ReportAggregates {
    return {
      net_sales: 0,
      gross_sales: 0,
      discounts_total: 0,
      fees_total: 0,
      shipping_charged: 0,
      shipping_cost: 0,
      cogs: null,
      cogs_confirmed_sales_count: 0,
      total_sales_count: 0,
      operating_expenses: 0,
      payroll_paid: 0,
      taxes_paid: 0,
      inventory_purchases: 0,
      owner_withdrawals: 0,
      reinvestment: 0,
      debt_principal_paid: 0,
      pending_expenses: 0,
      pending_payroll: 0,
      pending_taxes: 0,
      ...overrides,
    };
  }

  it('should return zeros for empty month', () => {
    const report = engine.calculate(makeAggregates());
    expect(report.net_sales).toBe(0);
    expect(report.gross_profit).toBeNull();
    expect(report.operating_profit).toBeNull();
    expect(report.net_profit).toBeNull();
  });

  it('should calculate full profit chain', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        gross_sales: 12000,
        discounts_total: 2000,
        cogs: 4000,
        cogs_confirmed_sales_count: 8,
        total_sales_count: 10,
        operating_expenses: 2000,
        payroll_paid: 1000,
        taxes_paid: 500,
      }),
    );

    expect(report.net_sales).toBe(10000);
    expect(report.gross_profit).toBe(6000);
    expect(report.operating_expenses).toBe(2000);
    expect(report.payroll_paid).toBe(1000);
    expect(report.calculated_operating_expenses).toBe(3000);
    expect(report.operating_profit).toBe(3000);
    expect(report.taxes_paid).toBe(500);
    expect(report.net_profit).toBe(2500);
  });

  it('should return null margins when net_sales is zero', () => {
    const report = engine.calculate(
      makeAggregates({
        cogs: 100,
        cogs_confirmed_sales_count: 1,
        total_sales_count: 1,
        operating_expenses: 50,
      }),
    );

    expect(report.gross_margin).toBeNull();
    expect(report.operating_margin).toBeNull();
    expect(report.net_margin).toBeNull();
  });

  it('should handle negative profit', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 1000,
        cogs: 1200,
        cogs_confirmed_sales_count: 5,
        total_sales_count: 5,
        operating_expenses: 500,
        taxes_paid: 100,
      }),
    );

    expect(report.gross_profit).toBe(-200);
    expect(report.operating_profit).toBe(-700);
    expect(report.net_profit).toBe(-800);
  });

  it('should handle partial cost coverage', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        cogs: 3000,
        cogs_confirmed_sales_count: 3,
        total_sales_count: 10,
      }),
    );

    expect(report.quality.sales_without_cost).toBe(7);
    expect(report.quality.cost_data_coverage).toBe(30);
    expect(report.quality.incomplete_cost_data).toBe(true);
  });

  it('should handle full cost coverage', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        cogs: 4000,
        cogs_confirmed_sales_count: 10,
        total_sales_count: 10,
      }),
    );

    expect(report.quality.sales_without_cost).toBe(0);
    expect(report.quality.cost_data_coverage).toBe(100);
    expect(report.quality.incomplete_cost_data).toBe(false);
  });

  it('should calculate projections with pending items', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        cogs: 4000,
        cogs_confirmed_sales_count: 10,
        total_sales_count: 10,
        operating_expenses: 2000,
        pending_expenses: 500,
        pending_payroll: 300,
        pending_taxes: 200,
      }),
    );

    expect(report.projection.pending_expenses).toBe(500);
    expect(report.projection.pending_payroll).toBe(300);
    expect(report.projection.pending_taxes).toBe(200);
    expect(report.projection.projected_net_profit).toBe(3000);
  });

  it('should return null projected profit when net profit is null', () => {
    const report = engine.calculate(makeAggregates({ pending_expenses: 100 }));

    expect(report.projection.projected_net_profit).toBeNull();
  });

  it('[no-duplication] payroll paid does not alter operating_expenses', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        cogs: 4000,
        cogs_confirmed_sales_count: 10,
        total_sales_count: 10,
        operating_expenses: 2000,
        payroll_paid: 1500,
      }),
    );

    // operating_expenses comes from expense categories with
    // affects_operating_profit: true, payroll is separate
    expect(report.operating_expenses).toBe(2000);
    expect(report.payroll_paid).toBe(1500);
    expect(report.calculated_operating_expenses).toBe(3500);
  });

  it('[no-duplication] inventory purchases do not alter cogs', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        cogs: 4000,
        cogs_confirmed_sales_count: 10,
        total_sales_count: 10,
        inventory_purchases: 3000,
      }),
    );

    // cogs comes from CostOfGoodsSold, inventory_purchases is separate
    expect(report.cogs).toBe(4000);
    expect(report.inventory_purchases).toBe(3000);
  });

  it('should calculate gross_profit_purchase_basis', () => {
    const report = engine.calculate(
      makeAggregates({
        net_sales: 10000,
        inventory_purchases: 4000,
      }),
    );

    expect(report.quality.gross_profit_purchase_basis).toBe(6000);
  });

  it('should expose separate lines for non-operating items', () => {
    const report = engine.calculate(
      makeAggregates({
        owner_withdrawals: 1000,
        reinvestment: 500,
        debt_principal_paid: 2000,
      }),
    );

    expect(report.owner_withdrawals).toBe(1000);
    expect(report.reinvestment).toBe(500);
    expect(report.debt_principal_paid).toBe(2000);
  });
});
