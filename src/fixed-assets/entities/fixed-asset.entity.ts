import { ApiProperty } from '@nestjs/swagger';
import { FixedAssetClass, FixedAssetKind } from '@prisma/client';

/*
 * Un activo con su depreciación a una fecha. La depreciación es línea recta de
 * gestión (para el EBITDA), no la fiscal exacta: sin INPC ni deducción
 * inmediata.
 */
export class FixedAssetEntity {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: FixedAssetKind })
  kind: FixedAssetKind;

  @ApiProperty({ enum: FixedAssetClass })
  asset_class: FixedAssetClass;

  @ApiProperty()
  acquisition_cost: number;

  @ApiProperty()
  acquired_at: Date;

  @ApiProperty({ description: 'La depreciación empieza el mes siguiente.' })
  in_service_at: Date;

  @ApiProperty()
  useful_life_months: number;

  @ApiProperty()
  salvage_value: number;

  @ApiProperty({ nullable: true, type: Date })
  disposed_at: Date | null;

  @ApiProperty({ nullable: true, type: Number })
  disposal_amount: number | null;

  @ApiProperty({ nullable: true, type: Number })
  expense_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({
    description:
      'Cuota de un mes completo (el último mes puede variar por centavos).',
  })
  monthly_depreciation: number;

  @ApiProperty({ description: 'Depreciación acumulada a `as_of`.' })
  accumulated_depreciation: number;

  @ApiProperty({ description: 'Costo − depreciación acumulada, a `as_of`.' })
  book_value: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Ganancia (+) o pérdida (−) de la baja. Nulo si sigue en uso.',
  })
  disposal_result: number | null;

  @ApiProperty({
    description: 'Ya no le quedan meses por depreciar a `as_of`.',
  })
  fully_depreciated: boolean;

  @ApiProperty()
  created_at: Date;

  constructor(partial: FixedAssetEntity) {
    Object.assign(this, partial);
  }
}

export class PaginatedFixedAssetsEntity {
  @ApiProperty({ type: [FixedAssetEntity] })
  data: FixedAssetEntity[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
