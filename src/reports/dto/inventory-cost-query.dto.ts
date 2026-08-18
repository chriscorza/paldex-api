import {
  IsOptional,
  IsInt,
  IsDateString,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InventoryCostQueryDto {
  @ApiPropertyOptional({
    description:
      'Año del periodo de ventas. Va junto con `month`. Sin periodo alguno se ' +
      'usa el mes en curso en la zona del negocio.',
    example: 2026,
  })
  @IsOptional()
  @IsInt()
  @Min(2000)
  year?: number;

  @ApiPropertyOptional({
    description: 'Mes del periodo, 1–12. Va junto con `year`.',
    example: 8,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    description:
      'Inicio del periodo. Se toma desde las 00:00 de ese día en la zona del ' +
      'negocio. Va junto con `end_date` y es excluyente con `year`+`month`.',
  })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({
    description:
      'Fin del periodo, incluido: hasta las 23:59:59.999 de ese día en la zona ' +
      'del negocio. Además fija la fecha a la que se lee el costo vigente.',
  })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({
    description:
      'Columna de ordenamiento. Por omisión `total_cost`, de mayor a menor.',
    enum: ['total_cost', 'unit_cost', 'units_sold', 'cogs_recorded'],
  })
  @IsOptional()
  @IsIn(['total_cost', 'unit_cost', 'units_sold', 'cogs_recorded'])
  sort_by?: 'total_cost' | 'unit_cost' | 'units_sold' | 'cogs_recorded';

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
      'Renglones por página, 50 por omisión. Los totales se calculan siempre ' +
      'sobre el catálogo completo, no sobre la página.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
