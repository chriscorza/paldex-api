import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IncomeStatementService,
  classifyExpense,
} from './income-statement.service';
import { ReportAggregates } from './profit-engine.service';
import { OwnershipContext } from '../common/ownership';

const Decimal = Prisma.Decimal;

describe('IncomeStatementService', () => {
  const ctx: OwnershipContext = { userId: 1, scope: 'OWN' };
  const range = { start_date: '2026-04-01', end_date: '2026-04-30' };

  const categories = [
    {
      id: 1,
      name: 'Compra de mercancía',
      type: 'COGS',
      affects_gross_profit: true,
      affects_operating_profit: false,
    },
    {
      id: 2,
      name: 'Renta local',
      type: 'OPERATING',
      affects_gross_profit: false,
      affects_operating_profit: true,
    },
    {
      id: 3,
      name: 'Suscripción Shopify',
      type: 'SHOPIFY_FEES',
      affects_gross_profit: true,
      affects_operating_profit: false,
    },
    {
      id: 4,
      name: 'Intereses de deuda',
      type: 'INTEREST',
      affects_gross_profit: false,
      affects_operating_profit: false,
    },
    {
      id: 5,
      name: 'Compra de activo fijo',
      type: 'CAPEX',
      affects_gross_profit: false,
      affects_operating_profit: false,
    },
    {
      id: 6,
      name: 'Pago de capital de deuda',
      type: 'DEBT',
      affects_gross_profit: false,
      affects_operating_profit: false,
    },
    {
      id: 7,
      name: 'Retiro del dueño',
      type: 'OWNER',
      affects_gross_profit: false,
      affects_operating_profit: false,
    },
    {
      id: 8,
      name: 'Reinversión',
      type: 'OWNER',
      affects_gross_profit: false,
      affects_operating_profit: false,
    },
    {
      id: 9,
      name: 'Meta Ads',
      type: 'MARKETING',
      affects_gross_profit: false,
      affects_operating_profit: true,
    },
  ];

  const aggregates = (
    overrides: Partial<ReportAggregates> = {},
  ): ReportAggregates => ({
    net_sales: 0,
    gross_sales: 0,
    discounts_total: 0,
    fees_total: 0,
    shipping_charged: 0,
    shipping_cost: 0,
    cogs: 0,
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
  });

  const asset = (overrides: Record<string, unknown> = {}) => ({
    id: 50,
    name: 'Laptop',
    kind: 'TANGIBLE',
    acquisition_cost: new Decimal(24000),
    salvage_value: new Decimal(0),
    useful_life_months: 12,
    acquired_at: new Date('2026-01-10T18:00:00Z'),
    in_service_at: new Date('2026-01-10T18:00:00Z'),
    disposed_at: null,
    disposal_amount: null,
    expense_id: 900,
    ...overrides,
  });

  const build = ({
    agg = aggregates(),
    expenses = [] as { category_id: number | null; amount: number }[],
    taxes = [] as { type: string; amount: number }[],
    assets = [] as unknown[],
  } = {}) => {
    const prisma: any = {
      expense: {
        groupBy: jest.fn().mockResolvedValue(
          expenses.map((e) => ({
            category_id: e.category_id,
            _sum: { amount: new Decimal(e.amount) },
          })),
        ),
      },
      expenseCategory: { findMany: jest.fn().mockResolvedValue(categories) },
      taxPayment: {
        groupBy: jest.fn().mockResolvedValue(
          taxes.map((t) => ({
            type: t.type,
            _sum: { amount: new Decimal(t.amount) },
          })),
        ),
      },
      fixedAsset: { findMany: jest.fn().mockResolvedValue(assets) },
    };
    const aggregation: any = {
      getMonthlyAggregates: jest.fn().mockResolvedValue(agg),
    };
    return {
      service: new IncomeStatementService(prisma, aggregation),
      prisma,
      aggregation,
    };
  };

  it('arma la cascada hasta la utilidad neta (escenario del spec)', async () => {
    /* Depreciación de 2,000 en abril: 24,000 / 12 meses. */
    const { service } = build({
      agg: aggregates({ net_sales: 100000, cogs: 40000, payroll_paid: 15000 }),
      expenses: [
        { category_id: 2, amount: 20000 },
        { category_id: 4, amount: 1000 },
      ],
      taxes: [
        { type: 'PAYROLL_TAX', amount: 3000 },
        { type: 'ISR', amount: 4000 },
      ],
      assets: [asset()],
    });

    const { summary } = await service.getIncomeStatement(ctx, range);

    expect(summary.gross_profit).toBe(60000);
    expect(summary.payroll).toBe(18000);
    expect(summary.ebitda).toBe(22000);
    expect(summary.depreciation_amortization).toBe(2000);
    expect(summary.ebit).toBe(20000);
    expect(summary.pre_tax_income).toBe(19000);
    expect(summary.net_income).toBe(15000);
    expect(summary.ebitda_margin).toBe(22);
  });

  it('el IVA no toca la utilidad: va al bloque de flujo', async () => {
    const { service } = build({
      agg: aggregates({ net_sales: 50000 }),
      taxes: [{ type: 'IVA', amount: 8000 }],
    });

    const result = await service.getIncomeStatement(ctx, range);

    expect(result.summary.net_income).toBe(50000);
    expect(result.cash_items.vat_paid).toBe(8000);
  });

  it('los intereses van abajo del EBIT', async () => {
    const { service } = build({
      agg: aggregates({ net_sales: 10000 }),
      expenses: [{ category_id: 4, amount: 1000 }],
    });

    const { summary } = await service.getIncomeStatement(ctx, range);

    expect(summary.ebitda).toBe(10000);
    expect(summary.ebit).toBe(10000);
    expect(summary.interest).toBe(1000);
    expect(summary.pre_tax_income).toBe(9000);
  });

  it('la compra de un activo es flujo, no gasto', async () => {
    const { service } = build({
      agg: aggregates({ net_sales: 10000 }),
      expenses: [{ category_id: 5, amount: 30000 }],
    });

    const result = await service.getIncomeStatement(ctx, range);

    expect(result.summary.net_income).toBe(10000);
    expect(result.cash_items.asset_purchases).toBe(30000);
  });

  it('una comisión capturada a mano reduce la utilidad bruta', async () => {
    const { service } = build({
      agg: aggregates({ net_sales: 10000, cogs: 4000 }),
      expenses: [{ category_id: 3, amount: 500 }],
    });

    const result = await service.getIncomeStatement(ctx, range);

    expect(result.summary.cost_of_sales).toBe(4500);
    expect(result.summary.gross_profit).toBe(5500);
    const costOfSales = result.lines.find((l) => l.key === 'cost_of_sales')!;
    expect(costOfSales.children!.map((c) => c.label)).toEqual([
      'Costo de lo vendido',
      'Suscripción Shopify',
    ]);
  });

  it('PAYROLL_TAX va en nómina y OTHER en operación', async () => {
    const { service } = build({
      agg: aggregates({ net_sales: 10000, payroll_paid: 2000 }),
      taxes: [
        { type: 'PAYROLL_TAX', amount: 700 },
        { type: 'OTHER', amount: 300 },
      ],
    });

    const result = await service.getIncomeStatement(ctx, range);

    expect(result.summary.payroll).toBe(2700);
    expect(result.summary.operating_expenses).toBe(300);
    expect(result.summary.income_tax).toBe(0);
  });

  it('la baja de un activo registra ganancia o pérdida abajo del EBIT y la venta en flujo', async () => {
    /* Feb–mar depreciados (4,000): valor en libros 20,000; se vende en 15,000 en abril. */
    const { service } = build({
      agg: aggregates({ net_sales: 10000 }),
      assets: [
        asset({
          disposed_at: new Date('2026-04-15T18:00:00Z'),
          disposal_amount: new Decimal(15000),
        }),
      ],
    });

    const result = await service.getIncomeStatement(ctx, range);

    expect(result.summary.depreciation_amortization).toBe(0);
    expect(result.summary.other_results).toBe(-5000);
    expect(result.summary.ebit).toBe(10000);
    expect(result.summary.pre_tax_income).toBe(5000);
    expect(result.cash_items.asset_sales).toBe(15000);
  });

  it('separa depreciación de amortización', async () => {
    const { service } = build({
      assets: [
        asset(),
        asset({
          id: 51,
          kind: 'INTANGIBLE',
          acquisition_cost: new Decimal(12000),
        }),
      ],
    });

    const result = await service.getIncomeStatement(ctx, range);
    const da = result.lines.find((l) => l.key === 'depreciation_amortization')!;

    expect(da.children!.find((c) => c.key === 'depreciation')!.amount).toBe(
      2000,
    );
    expect(da.children!.find((c) => c.key === 'amortization')!.amount).toBe(
      1000,
    );
  });

  it('ningún gasto pagado se pierde: cada uno cae en un renglón del P&L o del flujo', async () => {
    const expenses = categories.map((c, i) => ({
      category_id: c.id,
      amount: 1000 * (i + 1),
    }));
    expenses.push({ category_id: null as unknown as number, amount: 123 });
    const { service } = build({ expenses });

    const r = await service.getIncomeStatement(ctx, range);

    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const inPnl =
      r.summary.cost_of_sales -
      0 /* sin COGS de ventas */ +
      r.summary.operating_expenses +
      r.summary.interest;
    const inCash =
      r.cash_items.asset_purchases +
      r.cash_items.inventory_purchases +
      r.cash_items.debt_principal_paid +
      r.cash_items.owner_withdrawals +
      r.cash_items.reinvestment +
      r.cash_items.other_non_operating;
    expect(inPnl + inCash).toBe(total);
  });

  it('márgenes nulos sin ventas', async () => {
    const { service } = build();

    const { summary } = await service.getIncomeStatement(ctx, range);

    expect(summary.ebitda_margin).toBeNull();
    expect(summary.net_margin).toBeNull();
  });

  it('avisa de un activo comprado en el rango sin gasto vinculado', async () => {
    const { service } = build({
      assets: [
        asset({
          expense_id: null,
          acquired_at: new Date('2026-04-03T18:00:00Z'),
        }),
      ],
    });

    const { warnings } = await service.getIncomeStatement(ctx, range);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('ASSET_WITHOUT_PURCHASE_EXPENSE');
    expect(warnings[0].message).toContain('Laptop');
  });

  it('filtra por dueño y reutiliza los agregados del reporte mensual', async () => {
    const { service, prisma, aggregation } = build();

    await service.getIncomeStatement(ctx, range);

    expect(aggregation.getMonthlyAggregates).toHaveBeenCalledWith(
      ctx,
      expect.any(Date),
      expect.any(Date),
    );
    expect(prisma.expense.groupBy.mock.calls[0][0].where.user_id).toBe(1);
    expect(prisma.taxPayment.groupBy.mock.calls[0][0].where.user_id).toBe(1);
    expect(prisma.fixedAsset.findMany.mock.calls[0][0].where).toEqual({
      user_id: 1,
    });
  });

  it('rechaza rangos invertidos y de más de 366 días', async () => {
    const { service } = build();

    await expect(
      service.getIncomeStatement(ctx, {
        start_date: '2026-05-01',
        end_date: '2026-04-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getIncomeStatement(ctx, {
        start_date: '2025-01-01',
        end_date: '2026-02-05',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el CSV trae los mismos renglones que la respuesta', async () => {
    const { service } = build({
      agg: aggregates({ net_sales: 1000 }),
      expenses: [{ category_id: 2, amount: 100 }],
    });

    const statement = await service.getIncomeStatement(ctx, range);
    const rows = service.toCsvRows(statement);

    expect(rows[0]).toEqual(['key', 'label', 'level', 'amount', 'margin']);
    expect(rows.find((r) => r[0] === 'ebitda')![3]).toBe('900.00');
    expect(rows.find((r) => r[0] === 'category:2')![3]).toBe('100.00');
  });
});

describe('classifyExpense', () => {
  const cat = (type: string, extra: Record<string, unknown> = {}) => ({
    id: 1,
    name: 'x',
    type,
    affects_gross_profit: false,
    affects_operating_profit: false,
    ...extra,
  });

  it('una DEBT que afecta la operación es el modelo viejo de intereses', () => {
    expect(
      classifyExpense(cat('DEBT', { affects_operating_profit: true })),
    ).toBe('interest');
    expect(classifyExpense(cat('DEBT'))).toBe('debt_principal_paid');
  });

  it('sin categoría cuenta como operativo', () => {
    expect(classifyExpense(undefined)).toBe('operating');
  });

  it('una categoría que no afecta nada no se pierde', () => {
    expect(classifyExpense(cat('OTHER'))).toBe('other_non_operating');
  });
});
