import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsDateString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsArray,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncomeType } from '@prisma/client';

export class CreateIncomeDto {
  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  concept: string;

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsBoolean()
  invoiced: boolean;

  @ApiProperty()
  @IsInt()
  account_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_ids?: number[];

  @ApiPropertyOptional({ enum: IncomeType })
  @IsOptional()
  @IsEnum(IncomeType)
  income_type?: IncomeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  gross_amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discount_total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee_total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  shipping_charged?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  shipping_cost?: number;
}

export class UpdateIncomeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  concept?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  invoiced?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_ids?: number[];

  @ApiPropertyOptional({ enum: IncomeType })
  @IsOptional()
  @IsEnum(IncomeType)
  income_type?: IncomeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  gross_amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discount_total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee_total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  shipping_charged?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  shipping_cost?: number;
}
