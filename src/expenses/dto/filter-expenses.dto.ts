import {
  IsOptional,
  IsDateString,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ExpenseStatus,
  InvoiceStatus,
  ExpenseCategoryType,
} from '@prisma/client';

export class FilterExpensesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({ enum: ExpenseCategoryType })
  @IsOptional()
  @IsEnum(ExpenseCategoryType)
  category_type?: ExpenseCategoryType;

  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  invoice_status?: InvoiceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  is_tax_deductible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['date', 'amount', 'concept', 'created_at', 'id', 'paid_at'])
  sort_by?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
