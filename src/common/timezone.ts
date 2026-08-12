/*
 * Los reportes se leen en la zona del negocio, no en UTC.
 *
 * Filtrando en UTC, «julio» de una tienda de CDMX empezaba a las 18:00 del 30
 * de junio y terminaba a las 18:00 del 31 de julio: se perdía la última tarde
 * del mes —la de más venta— y se colaba la del mes anterior. Contra el reporte
 * de Shopify, que sí usa la zona de la tienda, eso daba una diferencia de miles
 * de pesos sin explicación aparente.
 *
 * Se hace con `Intl` en vez de traer una librería de fechas: es lo único que
 * necesita el proyecto y el runtime ya lo trae.
 */

const DEFAULT_TIME_ZONE = 'America/Mexico_City';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function reportsTimeZone(): string {
  return process.env.REPORTS_TIMEZONE || DEFAULT_TIME_ZONE;
}

/*
 * Cuánto se adelanta la zona respecto a UTC en ese instante concreto. Depende
 * del instante y no sólo de la zona: donde hay horario de verano, el mismo
 * lugar cambia de desplazamiento dos veces al año.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  /*
   * Los milisegundos se copian del instante: `formatToParts` sólo llega al
   * segundo, y sin esto un `23:59:59.999` se medía 999 ms corto y el rango se
   * pasaba de largo al día siguiente.
   */
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
    instant.getUTCMilliseconds(),
  );

  return asUtc - instant.getTime();
}

/*
 * Una hora de pared en una zona -> el instante UTC que le corresponde.
 *
 * Se calcula el desplazamiento dos veces porque la primera se mide sobre una
 * estimación que puede caer al otro lado de un cambio de horario.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(
    year,
    month - 1,
    day,
    hours,
    minutes,
    seconds,
    milliseconds,
  );

  const firstPass = zoneOffsetMs(new Date(guess), timeZone);
  const secondPass = zoneOffsetMs(new Date(guess - firstPass), timeZone);

  return new Date(guess - secondPass);
}

function parseDayParts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year, month, date];
}

/*
 * `2026-07-01` -> las 00:00:00.000 de ese día en la zona del negocio.
 *
 * Una cadena con hora se respeta tal cual: quien la manda ya eligió un
 * instante y no le corresponde a esto reinterpretarlo.
 */
export function startOfDayInZone(
  day: string,
  timeZone: string = reportsTimeZone(),
): Date {
  if (!DATE_ONLY.test(day)) return new Date(day);

  const [year, month, date] = parseDayParts(day);
  return zonedTimeToUtc(year, month, date, 0, 0, 0, 0, timeZone);
}

/*
 * `2026-07-31` -> las 23:59:59.999 de ese día en la zona del negocio.
 *
 * El día final entra entero. Tomarlo como su medianoche —lo que se hacía—
 * dejaba fuera todo el último día del rango que el usuario había elegido.
 */
export function endOfDayInZone(
  day: string,
  timeZone: string = reportsTimeZone(),
): Date {
  if (!DATE_ONLY.test(day)) return new Date(day);

  const [year, month, date] = parseDayParts(day);
  return zonedTimeToUtc(year, month, date, 23, 59, 59, 999, timeZone);
}

export function monthRangeInZone(
  year: number,
  month: number,
  timeZone: string = reportsTimeZone(),
): { startDate: Date; endDate: Date } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    startDate: zonedTimeToUtc(year, month, 1, 0, 0, 0, 0, timeZone),
    endDate: zonedTimeToUtc(year, month, lastDay, 23, 59, 59, 999, timeZone),
  };
}
