import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
} from 'class-validator';
import { ExpenseCategoryType } from '@prisma/client';

export class CreateExpenseCategoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: ExpenseCategoryType })
  @IsEnum(ExpenseCategoryType)
  type: ExpenseCategoryType;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  affects_gross_profit?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  affects_operating_profit?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_cash_outflow?: boolean;
}

export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  affects_gross_profit?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  affects_operating_profit?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_cash_outflow?: boolean;
}

export class FilterExpenseCategoriesDto {
  @ApiPropertyOptional({ enum: ExpenseCategoryType })
  @IsEnum(ExpenseCategoryType)
  @IsOptional()
  type?: ExpenseCategoryType;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_system?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  page?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  limit?: number;
}
