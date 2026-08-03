import { IsOptional, IsInt, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FilterProductCategoryOverridesDto {
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

export class CreateProductCategoryOverrideDto {
  @ApiProperty()
  @IsString()
  shopify_product_id: string;

  @ApiProperty()
  @IsString()
  category_name: string;
}

export class UpdateProductCategoryOverrideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category_name?: string;
}
