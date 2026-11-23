import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/*
 * Los dos extremos son obligatorios, sin «mes en curso» por omisión: quien
 * pregunta es el único que sabe qué periodo quiso decir el usuario (ver
 * DailySalesQueryDto). Tope de 366 días, validado en el servicio.
 */
export class IncomeStatementQueryDto {
  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsDateString()
  end_date: string;
}

export class IncomeStatementExportQueryDto extends IncomeStatementQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'pdf'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format?: 'csv' | 'pdf';
}
