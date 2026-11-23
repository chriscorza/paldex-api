import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { FixedAssetClass } from '@prisma/client';

export class FilterFixedAssetsDto {
  @ApiPropertyOptional({
    description:
      'Fecha a la que se calculan depreciación acumulada y valor en libros. Por omisión, hoy.',
  })
  @IsOptional()
  @IsDateString()
  as_of?: string;

  @ApiPropertyOptional({ enum: FixedAssetClass })
  @IsOptional()
  @IsEnum(FixedAssetClass)
  asset_class?: FixedAssetClass;

  @ApiPropertyOptional({ description: 'Buscar por nombre.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Incluir los dados de baja. Por omisión, sí.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_disposed?: boolean;

  @ApiPropertyOptional({
    enum: ['name', 'acquisition_cost', 'in_service_at', 'created_at'],
  })
  @IsOptional()
  @IsString()
  sort_by?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
