import {
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  IsString,
  IsInt,
  Min,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayrollStatus } from '@prisma/client';

export class GeneratePayrollDto {
  @ApiProperty()
  @IsDateString()
  start_date: string;

  @ApiProperty()
  @IsDateString()
  end_date: string;

  /*
   * Igual que en los gastos recurrentes: para dar de alta la nómina ya pagada
   * de meses anteriores sin tener que liquidarla pago a pago. Los periodos que
   * todavía no han vencido siguen naciendo en PENDING.
   */
  @ApiPropertyOptional({
    description:
      'Marca como pagados los periodos ya vencidos. Para cargar histórico.',
  })
  @IsOptional()
  @IsBoolean()
  already_paid?: boolean;
}

export class CreatePayrollPaymentDto {
  @ApiProperty()
  @IsInt()
  employee_id: number;

  @ApiProperty()
  @IsDateString()
  period_start: string;

  @ApiProperty()
  @IsDateString()
  period_end: string;

  @ApiProperty()
  @IsDateString()
  scheduled_pay_date: string;

  @ApiProperty()
  @IsNumber()
  gross_amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  bonuses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class PayPayrollDto {
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
  net_amount?: number;
}

export class UpdatePayrollPaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  bonuses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: PayrollStatus })
  @IsOptional()
  @IsEnum(PayrollStatus)
  status?: PayrollStatus;
}

export class FilterPayrollDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  employee_id?: number;

  @ApiPropertyOptional({ enum: PayrollStatus })
  @IsOptional()
  @IsEnum(PayrollStatus)
  status?: PayrollStatus;

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
  @IsIn(['scheduled_pay_date', 'paid_at'])
  date_field?: 'scheduled_pay_date' | 'paid_at';

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
