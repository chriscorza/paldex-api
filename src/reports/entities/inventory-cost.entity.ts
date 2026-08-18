import { ApiProperty } from '@nestjs/swagger';

export class InventoryCostPeriodEntity {
  @ApiProperty({
    description:
      'Inicio del periodo de ventas: 00:00:00.000 en la zona del negocio.',
  })
  start_date: Date;

  @ApiProperty({
    description:
      'Fin del periodo, incluido. También es la fecha a la que se lee el costo ' +
      'vigente de cada producto.',
  })
  end_date: Date;

  constructor(partial: InventoryCostPeriodEntity) {
    Object.assign(this, partial);
  }
}

export class InventoryCostProductEntity {
  @ApiProperty({ nullable: true })
  shopify_variant_id: string | null;

  @ApiProperty({ nullable: true })
  sku: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Nombre del artículo, tomado de la venta más reciente. `null` en un ' +
      'producto del catálogo que nunca se ha vendido: `ProductCost` no guarda ' +
      'nombre, sólo variante y SKU.',
  })
  title: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Costo unitario vigente al cierre del periodo. `null` cuando el producto ' +
      'no está en el catálogo y ninguna de sus ventas traía costo.',
  })
  unit_cost: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Desde cuándo aplica ese costo. Sólo para costos de catálogo.',
  })
  effective_from: Date | null;

  @ApiProperty({
    nullable: true,
    enum: ['VARIANT', 'SKU', 'FROZEN'],
    description:
      'De dónde salió el costo unitario: `VARIANT` y `SKU` son renglones de ' +
      '`ProductCost` —la misma precedencia que usa el cálculo de las ventas—; ' +
      '`FROZEN` es el costo que Shopify congeló en la venta, para productos que ' +
      'no están en el catálogo.',
  })
  cost_source: 'VARIANT' | 'SKU' | 'FROZEN' | null;

  @ApiProperty({
    description:
      'Si el producto tiene renglón en `ProductCost`. En falso, se está viendo ' +
      'un producto que se vendió pero nadie costeó.',
  })
  in_catalog: boolean;

  @ApiProperty({ description: 'Unidades vendidas en el periodo.' })
  units_sold: number;

  @ApiProperty({
    nullable: true,
    description:
      'Valuación de lo vendido al costo vigente: `unit_cost` × `units_sold`. ' +
      '`null` si no se conoce el costo unitario. Es la columna por la que se ' +
      'ordena el reporte.',
  })
  total_cost: number | null;

  @ApiProperty({
    description:
      'Lo que de verdad se cargó a resultados por este producto en el periodo, ' +
      'sumando el costo congelado de cada venta. Difiere de `total_cost` cuando ' +
      'el costo de catálogo cambió después de vender.',
  })
  cogs_recorded: number;

  constructor(partial: InventoryCostProductEntity) {
    Object.assign(this, partial);
  }
}

export class InventoryCostTotalsEntity {
  @ApiProperty({
    description: 'Productos distintos con costo en `ProductCost`.',
  })
  products_in_catalog: number;

  @ApiProperty({
    description:
      'Renglones del reporte: el catálogo más los productos vendidos que no ' +
      'están en él.',
  })
  products_listed: number;

  @ApiProperty({
    description:
      'Productos sin costo unitario conocido. Su `total_cost` no suma, así que ' +
      'el total va corto por debajo de lo que cuesta ese inventario.',
  })
  products_without_cost: number;

  @ApiProperty({
    description:
      'Productos del catálogo que no se vendieron en el periodo. Cuentan con ' +
      'costo unitario y cero de total.',
  })
  products_without_sales: number;

  @ApiProperty()
  units_sold: number;

  @ApiProperty({ description: 'Unidades vendidas sin costo conocido.' })
  units_without_cost: number;

  @ApiProperty({
    description:
      'Suma de `total_cost` de todos los productos: lo vendido en el periodo ' +
      'valuado al costo vigente.',
  })
  total_cost: number;

  @ApiProperty({
    description:
      'Suma de `cogs_recorded`. Sólo cubre ventas de Shopify, así que no tiene ' +
      'por qué coincidir con el `cogs` de `GET /reports/monthly`.',
  })
  cogs_recorded: number;

  @ApiProperty({
    nullable: true,
    description:
      'Porcentaje de unidades vendidas con costo conocido. `null` si no hubo ' +
      'ventas. Por debajo de 100, `total_cost` es un piso.',
  })
  cost_coverage: number | null;

  constructor(partial: InventoryCostTotalsEntity) {
    Object.assign(this, partial);
  }
}

export class InventoryCostReportEntity {
  @ApiProperty({ type: InventoryCostPeriodEntity })
  period: InventoryCostPeriodEntity;

  @ApiProperty({
    type: InventoryCostTotalsEntity,
    description:
      'Calculados sobre el catálogo completo, nunca sobre la página devuelta.',
  })
  totals: InventoryCostTotalsEntity;

  @ApiProperty({
    type: [InventoryCostProductEntity],
    description: 'Página de productos, de mayor a menor costo total.',
  })
  products: InventoryCostProductEntity[];

  @ApiProperty({ description: 'Productos en el reporte completo.' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  constructor(partial: InventoryCostReportEntity) {
    Object.assign(this, partial);
  }
}
