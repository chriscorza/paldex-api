import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/*
 * El listado recibía `@Query() q: any`. Sin metatipo, el ValidationPipe no
 * convierte nada, así que `?limit=12` llegaba como la cadena "12", se colaba
 * hasta el `take` de Prisma y el endpoint respondía 500. Sin parámetros
 * funcionaba, que es justo por lo que pasó desapercibido.
 */
export class ListMonthlyCloseDto {
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
