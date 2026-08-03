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
import { ExpenseStatus, InvoiceStatus } from '@prisma/client';

export class CreateExpenseDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paid_at?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  invoice_status?: InvoiceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoice_uuid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplier_rfc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  tax_amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  withholding_amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_tax_deductible?: boolean;
}

export class PayExpenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paid_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;
}
