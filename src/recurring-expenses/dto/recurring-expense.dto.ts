import {
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsDateString,
  IsBoolean,
  Min,
  Max,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecurringFrequency } from '@prisma/client';

export class CreateRecurringExpenseDto {
  @ApiProperty()
  @IsString()
  concept: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsInt()
  category_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  account_id?: number;

  @ApiProperty({ enum: RecurringFrequency })
  @IsEnum(RecurringFrequency)
  frequency: RecurringFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  due_day_of_week?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  due_day_of_month?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  second_due_day_of_month?: number;

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
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  auto_generate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requires_confirmation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRecurringExpenseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() concept?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() category_id?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() account_id?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(RecurringFrequency)
  frequency?: RecurringFrequency;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  due_day_of_week?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  due_day_of_month?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  second_due_day_of_month?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() start_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() end_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() auto_generate?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requires_confirmation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class GenerateRecurringDto {
  @ApiProperty()
  @IsDateString()
  start_date: string;

  @ApiProperty()
  @IsDateString()
  end_date: string;

  /*
   * Para cargar historia: lo que ya venció y ya se pagó entra como PAID, con
   * `paid_at` en su fecha de vencimiento. Sin esto habría que pagar a mano, uno
   * por uno, cada gasto de cada mes que se quiera dar de alta hacia atrás — y
   * en PENDING no cuentan en ningún reporte.
   *
   * Sólo afecta a los vencimientos ya pasados: los futuros siguen naciendo en
   * PENDING aunque el rango los incluya.
   */
  @ApiPropertyOptional({
    description:
      'Marca como pagados los vencimientos ya pasados. Para cargar histórico.',
  })
  @IsOptional()
  @IsBoolean()
  already_paid?: boolean;
}
