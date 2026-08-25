import {
  IsOptional,
  IsInt,
  IsArray,
  IsBoolean,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/*
 * El periodo se pide como `year`+`month` **o** como `start_date`+`end_date`,
 * igual que en `GET /reports/monthly`.
 *
 * Antes no se aceptaban rangos porque la respuesta declara un periodo y un rango
 * suelto la obligaba a decir un mes que no cubre. Ya no aplica: `period.year` y
 * `period.month` se llenan sólo cuando el periodo es exactamente un mes de
 * calendario, y valen `null` en cualquier otro rango. Un 15-ene a 15-feb no
 * declara «enero».
 */
export class SalesByEmployeeQueryDto {
  @ApiPropertyOptional({
    description:
      'Año del periodo. Va junto con `month`; sin ninguno de los dos —y sin ' +
      'rango— se devuelve el mes en curso en la zona del negocio.',
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

  @ApiPropertyOptional({
    description:
      'Primer día del rango, incluido. Va junto con `end_date` y no se puede ' +
      'combinar con `year`/`month`.',
    example: '2026-08-10',
  })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Último día del rango, incluido. Va junto con `start_date`.',
    example: '2026-08-16',
  })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  /*
   * Un `employee_ids=3` suelto llega como cadena, no como arreglo, y un
   * `employee_ids=3,5` llega entero en una sola cadena. Se normalizan los dos
   * aquí para que el resto pueda asumir `number[]`; lo que no sea número cae en
   * `NaN` y lo rechaza `@IsInt`.
   */
  @ApiPropertyOptional({
    type: [Number],
    description:
      'Sin él se devuelven todos los empleados. Con un id, sólo esa persona; ' +
      'con varios, sólo esas. Un id que no sea de un empleado propio es un 400.',
    example: [3, 5],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    return raw.map((v) =>
      typeof v === 'number' ? v : Number(String(v).trim()),
    );
  })
  @IsArray()
  @IsInt({ each: true })
  employee_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Si incluir el renglón `unassigned` (ventas de días sin dueño). Sin ' +
      'filtro de empleados va siempre; con filtro se omite salvo que se pida ' +
      'aquí. Los totales del periodo lo cuentan de todos modos.',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'boolean' ? value : value === 'true',
  )
  @IsBoolean()
  include_unassigned?: boolean;
}
