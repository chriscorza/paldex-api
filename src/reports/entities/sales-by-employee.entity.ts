import { ApiProperty } from '@nestjs/swagger';

export class SalesByEmployeePeriodEntity {
  @ApiProperty({ example: 2026 })
  year: number;

  @ApiProperty({ example: 8 })
  month: number;

  @ApiProperty({
    description:
      'Inicio del periodo: 00:00:00.000 del día 1 en la zona del negocio.',
  })
  start_date: Date;

  @ApiProperty({
    description:
      'Fin del periodo: 23:59:59.999 del último día en la zona del negocio, incluido.',
  })
  end_date: Date;

  constructor(partial: SalesByEmployeePeriodEntity) {
    Object.assign(this, partial);
  }
}

export class SalesByEmployeeRowEntity {
  @ApiProperty({
    nullable: true,
    description: 'Nulo en el renglón agregado de los días sin dueño.',
  })
  employee_id: number | null;

  @ApiProperty({ example: 'Luis' })
  employee_name: string;

  @ApiProperty({
    type: [Number],
    description:
      'Días atribuidos: 1 = lunes … 7 = domingo. Vacío en `unassigned`.',
    example: [1, 2, 3, 4, 5],
  })
  sales_days: number[];

  @ApiProperty({
    description: 'Suma de `net_amount` de las ventas de esos días.',
  })
  net_sales: number;

  @ApiProperty({
    description: 'Suma de `gross_amount` de las ventas de esos días.',
  })
  gross_sales: number;

  @ApiProperty({ description: 'Cuántos ingresos se sumaron.' })
  sales_count: number;

  @ApiProperty({
    description:
      'Costo de lo vendido esos días, de `CostOfGoodsSold` ligado a cada venta.',
  })
  cogs: number;

  @ApiProperty({
    description:
      'Ventas netas menos el costo de lo vendido. Es utilidad de producto: no ' +
      'descuenta el sueldo del empleado ni el gasto de la tienda.',
  })
  gross_profit: number;

  @ApiProperty({
    description:
      'De cuántas de esas ventas se conoce el costo. Si es menor que ' +
      '`sales_count`, `gross_profit` va inflado.',
  })
  sales_with_cost: number;

  @ApiProperty({
    nullable: true,
    description:
      'Porcentaje de ventas con costo capturado. `null` si no hubo ventas. ' +
      'Por debajo de 100 la utilidad es un techo, no una cifra firme.',
  })
  cost_data_coverage: number | null;

  constructor(partial: SalesByEmployeeRowEntity) {
    Object.assign(this, partial);
  }
}

export class SalesByEmployeeTotalsEntity {
  @ApiProperty()
  net_sales: number;

  @ApiProperty()
  gross_sales: number;

  @ApiProperty()
  sales_count: number;

  @ApiProperty()
  cogs: number;

  @ApiProperty()
  gross_profit: number;

  @ApiProperty()
  sales_with_cost: number;

  @ApiProperty({ nullable: true })
  cost_data_coverage: number | null;

  constructor(partial: SalesByEmployeeTotalsEntity) {
    Object.assign(this, partial);
  }
}

export class SalesByEmployeeReportEntity {
  @ApiProperty({ type: SalesByEmployeePeriodEntity })
  period: SalesByEmployeePeriodEntity;

  @ApiProperty({
    type: [SalesByEmployeeRowEntity],
    description:
      'Un renglón por empleado con días asignados, más `unassigned`, que aparece ' +
      'siempre aunque valga cero para que el total se pueda comprobar.',
  })
  rows: SalesByEmployeeRowEntity[];

  @ApiProperty({
    type: SalesByEmployeeTotalsEntity,
    description:
      'La suma de todos los renglones. `net_sales`, `cogs` y `gross_profit` ' +
      'deben coincidir con los de `GET /reports/monthly` del mismo periodo.',
  })
  totals: SalesByEmployeeTotalsEntity;

  constructor(partial: SalesByEmployeeReportEntity) {
    Object.assign(this, partial);
  }
}

export const UNASSIGNED_ROW_NAME = 'unassigned';
