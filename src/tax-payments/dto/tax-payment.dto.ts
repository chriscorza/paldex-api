import {
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  IsString,
  IsInt,
  Min,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxPaymentType } from '@prisma/client';

export class CreateTaxPaymentDto {
  @ApiProperty({ enum: TaxPaymentType })
  @IsEnum(TaxPaymentType)
  type: TaxPaymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tax_id?: string;

  @ApiProperty()
  @IsDateString()
  fiscal_period_start: string;

  @ApiProperty()
  @IsDateString()
  fiscal_period_end: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paid_at?: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsInt()
  account_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class PayTaxPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paid_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;
}

export class UpdateTaxPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(TaxPaymentType)
  type?: TaxPaymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tax_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fiscal_period_start?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fiscal_period_end?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: ['CANCELLED'] })
  @IsOptional()
  @IsEnum(['CANCELLED'])
  status?: 'CANCELLED';
}

export class FilterTaxPaymentsDto {
  @ApiPropertyOptional({ enum: TaxPaymentType })
  @IsOptional()
  @IsEnum(TaxPaymentType)
  type?: TaxPaymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['paid_at', 'fiscal_period_start'])
  date_field?: string;

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
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class TaxEstimateQueryDto {
  @ApiProperty()
  @IsDateString()
  start_date: string;

  @ApiProperty()
  @IsDateString()
  end_date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  isr_percentage?: number;
}
