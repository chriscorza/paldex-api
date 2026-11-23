import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import { endOfDayInZone, startOfDayInZone } from '../../common/timezone';

export const isoDate = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'Expected YYYY-MM-DD')
    .describe(what);

export const idArg = (what: string) => z.number().int().min(1).describe(what);

export const rangeInput = {
  start_date: isoDate('Primer día, incluido. YYYY-MM-DD.'),
  end_date: isoDate('Último día, incluido. YYYY-MM-DD.'),
};

export const pageInput = {
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

/* Rango en la zona del negocio, como los reportes REST. Sin periodo implícito. */
export const rangeOf = (args: { start_date: string; end_date: string }) => {
  const startDate = startOfDayInZone(args.start_date);
  const endDate = endOfDayInZone(args.end_date);
  if (endDate < startDate) {
    throw new BadRequestException('end_date must not precede start_date');
  }
  return { startDate, endDate };
};

export const DATE_RULE =
  'Todas las fechas son explícitas (YYYY-MM-DD): resuelve tú qué quiso decir el usuario con "hoy" o "este mes" usando context_get.today.';

export const WRITE_RULE =
  'Escribe en los libros de la cuenta a la que está ligada la llave; no hay argumento para elegir dueño. ' +
  'Los ids (cuentas, categorías, empleados) salen de context_get o de las tools *_list: nunca los adivines.';
