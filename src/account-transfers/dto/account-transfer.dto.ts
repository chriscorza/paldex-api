import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateAccountTransferDto {
  @ApiProperty({ description: 'Cuenta de la que sale el dinero.' })
  @IsInt()
  @Min(1)
  from_account_id: number;

  @ApiProperty({ description: 'Cuenta a la que llega el dinero.' })
  @IsInt()
  @Min(1)
  to_account_id: number;

  @ApiProperty({
    example: 50000,
    description: 'Lo que llega a la cuenta destino.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({
    example: '2027-01-15',
    description:
      'Día del traspaso (YYYY-MM-DD, en la zona del negocio). Una hora, si viene, se ignora.',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Comisión cobrada por el traspaso (por ejemplo, por retirar de Mercado Pago). Se registra como un gasto pagado desde la cuenta origen. 0 = sin comisión.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fee_amount?: number;

  @ApiPropertyOptional({
    description:
      'Categoría del gasto de la comisión. Obligatoria si fee_amount > 0. No puede ser de nómina.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  fee_category_id?: number;

  @ApiPropertyOptional({ example: 'Retiro de Mercado Pago a BBVA' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAccountTransferDto extends PartialType(
  CreateAccountTransferDto,
) {}

export class FilterAccountTransfersDto {
  @ApiPropertyOptional({
    description: 'Sólo los traspasos que salen de o llegan a esta cuenta.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  account_id?: number;

  @ApiPropertyOptional({ description: 'Desde este día, incluido. YYYY-MM-DD.' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'Hasta este día, incluido. YYYY-MM-DD.' })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
