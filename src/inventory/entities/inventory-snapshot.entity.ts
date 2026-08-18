import { ApiProperty } from '@nestjs/swagger';
import { toMoneyNumber } from '../../common/money';

export class InventorySnapshotEntity {
  @ApiProperty()
  id: number;

  @ApiProperty()
  shopify_connection_id: number;

  @ApiProperty({ description: 'Cuándo se tomó la foto.' })
  taken_at: Date;

  @ApiProperty({
    enum: ['PENDING', 'COMPLETE', 'FAILED'],
    description:
      'Sólo las `COMPLETE` se pueden valuar: una captura que se cayó a la ' +
      'mitad queda `FAILED` con sus renglones parciales, útiles para depurar.',
  })
  status: string;

  @ApiProperty({ description: 'Piezas con existencia conocida.' })
  total_units: number;

  @ApiProperty({ description: 'Lo que costó el inventario de esa foto.' })
  total_cost: number;

  @ApiProperty({
    description:
      'Lo que entraría vendiéndolo todo a precio de lista, sin descuento. Es un ' +
      'techo. Vale 0 en las fotos tomadas antes de que se capturaran precios.',
  })
  retail_value: number;

  @ApiProperty()
  products_valued: number;

  @ApiProperty({ description: 'Productos sin costo: el total va corto.' })
  products_without_cost: number;

  @ApiProperty({ description: 'Variantes cuya existencia Shopify no rastrea.' })
  variants_untracked: number;

  @ApiProperty({ nullable: true })
  failure_reason: string | null;

  constructor(partial: any) {
    this.id = partial.id;
    this.shopify_connection_id = partial.shopify_connection_id;
    this.taken_at = partial.taken_at;
    this.status = partial.status;
    this.total_units = partial.total_units;
    this.total_cost = toMoneyNumber(partial.total_cost) ?? 0;
    this.retail_value = toMoneyNumber(partial.retail_value) ?? 0;
    this.products_valued = partial.products_valued;
    this.products_without_cost = partial.products_without_cost;
    this.variants_untracked = partial.variants_untracked;
    this.failure_reason = partial.failure_reason ?? null;
  }
}

export class InventorySnapshotListEntity {
  @ApiProperty({ type: [InventorySnapshotEntity] })
  data: InventorySnapshotEntity[];

  @ApiProperty({ description: 'Fotos del dueño en total, no de esta página.' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  constructor(partial: InventorySnapshotListEntity) {
    Object.assign(this, partial);
  }
}

export const INVENTORY_SNAPSHOT_SELECT = {
  id: true,
  shopify_connection_id: true,
  taken_at: true,
  status: true,
  total_units: true,
  total_cost: true,
  retail_value: true,
  products_valued: true,
  products_without_cost: true,
  variants_untracked: true,
  failure_reason: true,
} as const;
