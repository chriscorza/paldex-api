import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FixedAssetClass, FixedAssetKind } from '@prisma/client';

export class CreateFixedAssetDto {
  @ApiProperty({ example: 'Laptop de diseño' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: FixedAssetClass,
    description:
      'Propone la vida útil (tasas máximas de la LISR) y el `kind` si no se indican.',
  })
  @IsEnum(FixedAssetClass)
  asset_class: FixedAssetClass;

  @ApiPropertyOptional({
    enum: FixedAssetKind,
    description:
      'INTANGIBLE se reporta como amortización en vez de depreciación. Por omisión, el de la clase.',
  })
  @IsOptional()
  @IsEnum(FixedAssetKind)
  kind?: FixedAssetKind;

  @ApiProperty({ example: 30000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  acquisition_cost: number;

  @ApiProperty({ example: '2026-03-08', description: 'Fecha de compra.' })
  @IsDateString()
  acquired_at: string;

  @ApiProperty({
    example: '2026-03-10',
    description:
      'Desde cuándo se usa. La depreciación empieza el mes siguiente. No puede ser anterior a la compra.',
  })
  @IsDateString()
  in_service_at: string;

  @ApiPropertyOptional({
    example: 40,
    description: 'Meses. Si se omite, la sugerida por la clase.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  useful_life_months?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Lo que valdrá al final de su vida útil. Menor que el costo.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salvage_value?: number;

  @ApiPropertyOptional({
    description:
      'El gasto con que se pagó. Debe ser del mismo dueño y estar en una categoría CAPEX ("Compra de activo fijo"); si no, 400.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expense_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
