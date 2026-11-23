import {
  IncomeStatementPdfService,
  buildCashRows,
  buildNotes,
  buildRows,
  formatAmount,
  formatPercent,
  formatPeriod,
} from './income-statement-pdf.service';
import { IncomeStatementEntity } from './entities/income-statement.entity';

const statement = (
  overrides: Partial<IncomeStatementEntity> = {},
): IncomeStatementEntity => ({
  period: { start_date: '2026-10-01', end_date: '2026-10-31' },
  basis: 'CASH',
  lines: [
    {
      key: 'net_sales',
      label: 'Ventas netas',
      amount: 100000,
      kind: 'subtotal',
      level: 0,
      margin: 100,
    },
    {
      key: 'cost_of_sales',
      label: 'Costo de ventas',
      amount: 40000,
      kind: 'line',
      level: 0,
      children: [
        {
          key: 'cogs',
          label: 'Costo de lo vendido',
          amount: 40000,
          kind: 'line',
          level: 1,
        },
        {
          key: 'category:3',
          label: 'Comisión',
          amount: 0,
          kind: 'line',
          level: 1,
        },
      ],
    },
    {
      key: 'gross_profit',
      label: 'Utilidad bruta',
      amount: 60000,
      kind: 'subtotal',
      level: 0,
      margin: 60,
    },
    {
      key: 'ebitda',
      label: 'EBITDA',
      amount: 22000,
      kind: 'subtotal',
      level: 0,
      margin: 22,
    },
    {
      key: 'other_results',
      label: 'Ganancia/pérdida en baja de activos',
      amount: 0,
      kind: 'line',
      level: 0,
    },
    {
      key: 'net_income',
      label: 'Utilidad neta',
      amount: -1500,
      kind: 'subtotal',
      level: 0,
      margin: -1.5,
    },
  ],
  summary: {
    net_sales: 100000,
    cost_of_sales: 40000,
    gross_profit: 60000,
    operating_expenses: 0,
    payroll: 0,
    ebitda: 22000,
    depreciation_amortization: 0,
    ebit: 22000,
    interest: 0,
    other_results: 0,
    pre_tax_income: 22000,
    income_tax: 0,
    net_income: -1500,
    gross_margin: 60,
    ebitda_margin: 22,
    ebit_margin: 22,
    pre_tax_margin: 22,
    net_margin: -1.5,
  },
  cash_items: {
    vat_paid: 8000,
    asset_purchases: 0,
    asset_sales: 0,
    inventory_purchases: 0,
    debt_principal_paid: 0,
    owner_withdrawals: 20000,
    reinvestment: 0,
    other_non_operating: 0,
  },
  quality: {
    sales_without_cost: 0,
    cost_data_coverage: 100,
    incomplete_cost_data: false,
  },
  warnings: [],
  ...overrides,
});

describe('formatters del PDF', () => {
  it('pone entre paréntesis lo que resta y los subtotales negativos', () => {
    expect(formatAmount(20000, true)).toBe('(20,000.00)');
    expect(formatAmount(0, true)).toBe('0.00');
    expect(formatAmount(-1500, false)).toBe('(1,500.00)');
    expect(formatAmount(1500, false)).toBe('1,500.00');
  });

  it('porcentaje sobre ventas, vacío sin ventas', () => {
    expect(formatPercent(22000, 100000)).toBe('22.0%');
    expect(formatPercent(100, 0)).toBe('');
  });

  it('nombra un mes completo como mes y cualquier otro rango con sus fechas', () => {
    expect(formatPeriod('2026-10-01', '2026-10-31')).toBe('Octubre de 2026');
    expect(formatPeriod('2026-02-01', '2026-02-28')).toBe('Febrero de 2026');
    expect(formatPeriod('2026-01-01', '2026-03-31')).toBe(
      'Del 1 de enero de 2026 al 31 de marzo de 2026',
    );
    expect(formatPeriod('2026-10-01', '2026-10-30')).toMatch(
      /^Del 1 de octubre/,
    );
  });
});

describe('buildRows', () => {
  it('arma la cascada con estilos y omite desgloses y bajas en cero', () => {
    const rows = buildRows(statement());

    expect(rows.map((r) => [r.key, r.style])).toEqual([
      ['net_sales', 'subtotal'],
      ['cost_of_sales', 'section'],
      ['cogs', 'detail'],
      ['gross_profit', 'subtotal'],
      ['ebitda', 'highlight'],
      ['net_income', 'result'],
    ]);
  });

  it('firma los montos como en contabilidad', () => {
    const rows = buildRows(statement());
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(byKey.cost_of_sales.amount).toBe('(40,000.00)');
    expect(byKey.cogs.amount).toBe('40,000.00');
    expect(byKey.net_income.amount).toBe('(1,500.00)');
    expect(byKey.net_income.negative).toBe(true);
    expect(byKey.ebitda.percent).toBe('22.0%');
  });
});

describe('bloques secundarios', () => {
  it('el bloque de flujo sólo trae lo que no es cero', () => {
    expect(buildCashRows(statement())).toEqual([
      { label: 'IVA enterado al SAT', amount: '$8,000.00' },
      { label: 'Retiros del dueño', amount: '$20,000.00' },
    ]);
  });

  it('los avisos incluyen costo incompleto y activos sin gasto', () => {
    const notes = buildNotes(
      statement({
        quality: {
          sales_without_cost: 3,
          cost_data_coverage: 80,
          incomplete_cost_data: true,
        },
        warnings: [
          {
            code: 'ASSET_WITHOUT_PURCHASE_EXPENSE',
            message: 'El activo "Laptop"…',
          },
        ],
      }),
    );

    expect(notes[0]).toMatch(/Sólo el 80%/);
    expect(notes[1]).toMatch(/Laptop/);
  });

  it('sin problemas no hay avisos', () => {
    expect(buildNotes(statement())).toEqual([]);
  });
});

describe('IncomeStatementPdfService.render', () => {
  it('produce un PDF válido', async () => {
    const pdf = await new IncomeStatementPdfService().render(statement(), {
      businessName: 'Corszas',
      generatedAt: new Date('2026-11-23T18:00:00Z'),
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('pagina un estado de resultados largo sin romperse', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      key: `category:${i}`,
      label: `Gasto ${i}`,
      amount: 100 + i,
      kind: 'line' as const,
      level: 1,
    }));
    const long = statement({
      lines: [
        ...statement().lines.slice(0, 3),
        {
          key: 'operating_expenses',
          label: 'Gastos de operación',
          amount: 20000,
          kind: 'line',
          level: 0,
          children: many,
        },
        ...statement().lines.slice(3),
      ],
    });

    const pdf = await new IncomeStatementPdfService().render(long, {
      businessName: 'Corszas',
      generatedAt: new Date(),
    });

    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [])
      .length;
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});
