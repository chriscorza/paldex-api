import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/*
 * Sin `start_date`/`end_date` a propósito: el reporte se pide por meses, y un
 * rango suelto obligaría a explicar qué mes declara la respuesta.
 */
export class SalesByEmployeeQueryDto {
  @ApiPropertyOptional({
    description:
      'Año del periodo. Va junto con `month`; sin ninguno de los dos se ' +
      'devuelve el mes en curso en la zona del negocio.',
    example: 2026,
  })
  @IsOptional()
  @IsInt()
  @Min(2000)
  year?: number;

  @ApiPropertyOptional({
    description: 'Mes del periodo, 1–12. Va junto con `year`.',
    example: 8,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}
