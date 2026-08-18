import { IsOptional, IsInt, IsDateString, IsIn, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InventoryValuationQueryDto {
  @ApiPropertyOptional({
    description:
      'Foto concreta que se quiere valuar. Sin esto se usa la más reciente ' +
      'completa del dueño.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  snapshot_id?: number;

  @ApiPropertyOptional({
    description:
      'Valúa con la foto más reciente tomada en o antes de ese día, leído en ' +
      'la zona del negocio. Excluyente con `snapshot_id`.',
  })
  @IsOptional()
  @IsDateString()
  as_of?: string;

  @ApiPropertyOptional({
    description: 'Por omisión `total_cost`, de mayor a menor.',
    enum: ['total_cost', 'unit_cost', 'quantity_on_hand'],
  })
  @IsOptional()
  @IsIn(['total_cost', 'unit_cost', 'quantity_on_hand'])
  sort_by?: 'total_cost' | 'unit_cost' | 'quantity_on_hand';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Página, desde 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description:
      'Renglones por página, 50 por omisión. Los totales se calculan sobre el ' +
      'avalúo completo, no sobre la página.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class InventorySnapshotsQueryDto {
  @ApiPropertyOptional({ description: 'Página, desde 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Fotos por página, 50 por omisión.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
