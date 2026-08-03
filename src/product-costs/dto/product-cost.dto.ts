import {
  IsInt,
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  Min,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductCostSource } from '@prisma/client';

export class CreateProductCostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shopify_variant_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  unit_cost: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @ApiPropertyOptional({ enum: ProductCostSource })
  @IsOptional()
  @IsEnum(ProductCostSource)
  source?: ProductCostSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProductCostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  unit_cost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @ApiPropertyOptional({ enum: ProductCostSource })
  @IsOptional()
  @IsEnum(ProductCostSource)
  source?: ProductCostSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkProductCostEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shopify_variant_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  unit_cost: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @ApiPropertyOptional({ enum: ProductCostSource })
  @IsOptional()
  @IsEnum(ProductCostSource)
  source?: ProductCostSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkProductCostDto {
  @ApiProperty({ type: [BulkProductCostEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BulkProductCostEntryDto)
  entries: BulkProductCostEntryDto[];
}

export class FilterProductCostsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shopify_variant_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
