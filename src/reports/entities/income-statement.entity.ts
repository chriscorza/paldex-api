import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IncomeStatementLineEntity {
  @ApiProperty({
    example: 'operating_expenses',
    description:
      'Identificador estable del renglón. Los de categoría son `category:<id>`.',
  })
  key: string;

  @ApiProperty({ example: 'Gastos de operación' })
  label: string;

  @ApiProperty({
    description:
      'Costos y gastos en positivo (el renglón resta); subtotales y `other_results` con su signo.',
  })
  amount: number;

  @ApiProperty({
    enum: ['line', 'subtotal'],
    description:
      '`subtotal` para ventas netas, utilidad bruta, EBITDA, EBIT, UAI y utilidad neta.',
  })
  kind: 'line' | 'subtotal';

  @ApiProperty({ description: '0 = renglón principal, 1 = desglose.' })
  level: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Sólo en subtotales: margen sobre ventas netas. Nulo sin ventas.',
  })
  margin?: number | null;

  @ApiPropertyOptional({ type: () => [IncomeStatementLineEntity] })
  children?: IncomeStatementLineEntity[];
}

export class IncomeStatementSummaryEntity {
  @ApiProperty() net_sales: number;
  @ApiProperty() cost_of_sales: number;
  @ApiProperty() gross_profit: number;
  @ApiProperty() operating_expenses: number;
  @ApiProperty({ description: 'Neto pagado + PAYROLL_TAX.' }) payroll: number;
  @ApiProperty() ebitda: number;
  @ApiProperty() depreciation_amortization: number;
  @ApiProperty() ebit: number;
  @ApiProperty() interest: number;
  @ApiProperty({
    description: 'Ganancia (+) o pérdida (−) en baja de activos.',
  })
  other_results: number;
  @ApiProperty() pre_tax_income: number;
  @ApiProperty({ description: 'ISR pagado.' }) income_tax: number;
  @ApiProperty() net_income: number;

  @ApiProperty({ nullable: true, type: Number }) gross_margin: number | null;
  @ApiProperty({ nullable: true, type: Number }) ebitda_margin: number | null;
  @ApiProperty({ nullable: true, type: Number }) ebit_margin: number | null;
  @ApiProperty({ nullable: true, type: Number }) pre_tax_margin: number | null;
  @ApiProperty({ nullable: true, type: Number }) net_margin: number | null;
}

export class IncomeStatementCashItemsEntity {
  @ApiProperty({ description: 'TaxPayment IVA pagado: no es gasto.' })
  vat_paid: number;
  @ApiProperty({ description: 'Gastos en categorías CAPEX.' })
  asset_purchases: number;
  @ApiProperty({
    description: 'Entrada: lo recibido por activos dados de baja.',
  })
  asset_sales: number;
  @ApiProperty({
    description:
      'Gastos en categorías COGS (el COGS del P&L sale de CostOfGoodsSold).',
  })
  inventory_purchases: number;
  @ApiProperty() debt_principal_paid: number;
  @ApiProperty() owner_withdrawals: number;
  @ApiProperty() reinvestment: number;
  @ApiProperty({
    description:
      'Gastos en categorías que no afectan la operación y no encajan en otro renglón. Deberían ser 0: si no, revisa esas categorías.',
  })
  other_non_operating: number;
}

export class IncomeStatementQualityEntity {
  @ApiProperty() sales_without_cost: number;
  @ApiProperty({ nullable: true, type: Number })
  cost_data_coverage: number | null;
  @ApiProperty({
    description:
      'Con costo incompleto, la utilidad bruta y todo lo de abajo es un techo.',
  })
  incomplete_cost_data: boolean;
}

export class IncomeStatementWarningEntity {
  @ApiProperty({ enum: ['ASSET_WITHOUT_PURCHASE_EXPENSE'] })
  code: string;
  @ApiProperty() message: string;
  @ApiPropertyOptional() asset_id?: number;
}

export class IncomeStatementEntity {
  @ApiProperty({
    example: { start_date: '2026-01-01', end_date: '2026-03-31' },
  })
  period: { start_date: string; end_date: string };

  @ApiProperty({
    enum: ['CASH'],
    description: 'Base de efectivo, como GET /reports/monthly.',
  })
  basis: 'CASH';

  @ApiProperty({ type: [IncomeStatementLineEntity] })
  lines: IncomeStatementLineEntity[];

  @ApiProperty({ type: IncomeStatementSummaryEntity })
  summary: IncomeStatementSummaryEntity;

  @ApiProperty({ type: IncomeStatementCashItemsEntity })
  cash_items: IncomeStatementCashItemsEntity;

  @ApiProperty({ type: IncomeStatementQualityEntity })
  quality: IncomeStatementQualityEntity;

  @ApiProperty({ type: [IncomeStatementWarningEntity] })
  warnings: IncomeStatementWarningEntity[];
}
