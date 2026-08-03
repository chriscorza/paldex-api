import { IsNumber, IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CogsSource } from '@prisma/client';

export class CreateCogsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  product_reference?: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiProperty()
  @IsNumber()
  unit_cost: number;

  @ApiPropertyOptional({ enum: CogsSource })
  @IsOptional()
  @IsEnum(CogsSource)
  source?: CogsSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCogsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  product_reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unit_cost?: number;

  @ApiPropertyOptional({ enum: CogsSource })
  @IsOptional()
  @IsEnum(CogsSource)
  source?: CogsSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
