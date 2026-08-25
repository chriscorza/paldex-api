import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/*
 * Los dos extremos son obligatorios a propósito: no hay «mes en curso» por
 * defecto.
 *
 * Quien pregunta —la app o el agente— es el único que sabe qué quiso decir el
 * usuario con «este mes» o «la semana pasada». Poner aquí una segunda noción de
 * «actual» crea dos relojes que pueden discrepar, y la discrepancia saldría como
 * un periodo equivocado en vez de como un error.
 */
export class DailySalesQueryDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  end_date: string;
}
