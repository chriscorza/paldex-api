import { ApiProperty } from '@nestjs/swagger';

export class InventoryValuationSourceEntity {
  @ApiProperty({
    type: [Number],
    description:
      'Fotos usadas. Normalmente una; hay más si el dueño tiene varias ' +
      'conexiones de Shopify, en cuyo caso se toma la más reciente de cada una.',
  })
  snapshot_ids: number[];

  @ApiProperty({ description: 'Fecha de la foto más reciente de las usadas.' })
  taken_at: Date;

  @ApiProperty({ description: 'Conexiones de Shopify que cubre el avalúo.' })
  connections: number;

  constructor(partial: InventoryValuationSourceEntity) {
    Object.assign(this, partial);
  }
}

export class InventoryValuationProductEntity {
  @ApiProperty({ nullable: true })
  shopify_variant_id: string | null;

  @ApiProperty({ nullable: true })
  sku: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({
    nullable: true,
    description:
      'Piezas en existencia, con todas las sucursales sumadas —el desglose por ' +
      'sucursal exige el scope `read_locations`, que la app no pide—. `null` ' +
      'cuando Shopify no rastrea el producto: es existencia desconocida, no cero.',
  })
  quantity_on_hand: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Costo unitario congelado al tomar la foto. `null` si no se conoce.',
  })
  unit_cost: number | null;

  @ApiProperty({
    nullable: true,
    enum: ['VARIANT', 'SKU', 'SHOPIFY'],
    description:
      'De dónde salió el costo: `ProductCost` por variante, `ProductCost` por ' +
      'SKU, o el `unitCost` que reporta Shopify.',
  })
  cost_source: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Piezas × costo unitario. `null` si falta el costo o la existencia. Es ' +
      'la columna por la que se ordena.',
  })
  total_cost: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Precio de lista de Shopify: lo que la tienda pide hoy por la pieza. No ' +
      'descuenta promociones ni cupones.',
  })
  unit_price: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Piezas × precio de lista: lo que entraría si se vendiera todo sin ' +
      'descuento. `null` si falta el precio o la existencia.',
  })
  total_price: number | null;

  constructor(partial: InventoryValuationProductEntity) {
    Object.assign(this, partial);
  }
}

export class InventoryValuationTotalsEntity {
  @ApiProperty({ description: 'Productos distintos en la foto.' })
  products: number;

  @ApiProperty({ description: 'Productos con costo unitario conocido.' })
  products_valued: number;

  @ApiProperty({
    description:
      'Productos sin costo. Su mercancía no suma: el total va corto por debajo ' +
      'de lo que realmente vale el inventario.',
  })
  products_without_cost: number;

  @ApiProperty({
    description: 'Productos cuya existencia Shopify no rastrea.',
  })
  products_untracked: number;

  @ApiProperty({ description: 'Piezas con existencia conocida.' })
  total_units: number;

  @ApiProperty({ description: 'Piezas con existencia conocida y sin costo.' })
  units_without_cost: number;

  @ApiProperty({
    description:
      'Lo que vale el inventario: suma de piezas × costo unitario. No es un ' +
      'costo PEPS ni promedio ponderado — valúa al costo vigente, así que un ' +
      'alza revalúa mercancía comprada barata.',
  })
  total_cost: number;

  @ApiProperty({
    nullable: true,
    description:
      'Porcentaje de las piezas conocidas que quedó valuado. `null` sin ' +
      'existencias. Por debajo de 100, el total es un piso.',
  })
  cost_coverage: number | null;

  @ApiProperty({
    description:
      'Lo que entraría si se vendiera todo el inventario al precio de lista, ' +
      'sin un solo descuento. Es un techo, no un pronóstico: nadie vende su ' +
      'inventario completo ni a precio de lista.',
  })
  retail_value: number;

  @ApiProperty({
    description:
      'La diferencia: `retail_value` menos `total_cost`. La ganancia bruta que ' +
      'queda por cobrar en esa mercancía, antes de descuentos y de cualquier ' +
      'gasto de la tienda.',
  })
  potential_profit: number;

  @ApiProperty({
    nullable: true,
    description:
      'Margen de esa ganancia sobre el precio de venta. `null` si no hay valor ' +
      'de venta que dividir.',
  })
  potential_margin: number | null;

  @ApiProperty({
    description:
      'Productos con precio de lista conocido. Si es menor que ' +
      '`products`, `retail_value` va corto.',
  })
  products_priced: number;

  constructor(partial: InventoryValuationTotalsEntity) {
    Object.assign(this, partial);
  }
}

export class InventoryValuationReportEntity {
  @ApiProperty({ type: InventoryValuationSourceEntity })
  source: InventoryValuationSourceEntity;

  @ApiProperty({
    type: InventoryValuationTotalsEntity,
    description: 'Sobre el avalúo completo, nunca sobre la página devuelta.',
  })
  totals: InventoryValuationTotalsEntity;

  @ApiProperty({ type: [InventoryValuationProductEntity] })
  products: InventoryValuationProductEntity[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  constructor(partial: InventoryValuationReportEntity) {
    Object.assign(this, partial);
  }
}
