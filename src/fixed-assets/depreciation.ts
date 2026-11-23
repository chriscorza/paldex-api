import { Prisma } from '@prisma/client';
import { dateKeyInZone, reportsTimeZone } from '../common/timezone';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/*
 * Depreciación de un activo fijo (amortización si es intangible): línea recta,
 * meses completos, calculada al leer.
 *
 * - Base depreciable: costo − valor residual.
 * - Cuota mensual: base ÷ vida útil, redondeada a centavos; el último mes
 *   absorbe el residuo para que la suma sea exactamente la base.
 * - Empieza el mes siguiente a `in_service_at` (regla del SAT, art. 31 LISR):
 *   así no hay que prorratear días.
 * - Termina al agotarse la vida útil o en el mes de la baja, sin incluirlo.
 *
 * No se guarda como filas mensuales: es una función pura del activo. Corregir
 * un activo corrige todos los meses a la vez, y no hay un cron que se pueda
 * saltar un mes. Lo que se paga por eso —que editar un activo mueva meses
 * cerrados— lo detecta el fingerprint de MonthlyClose.
 *
 * Los meses se cuentan en la zona del negocio, igual que los reportes: un
 * activo que entra en uso el 31 de marzo a las 20:00 en CDMX entró en marzo,
 * aunque en UTC ya sea abril.
 *
 * Es depreciación de gestión, para el EBITDA. No es la fiscal exacta (sin
 * actualización por INPC ni deducción inmediata).
 */

export interface DepreciableAsset {
  acquisition_cost: Decimal | number | string;
  salvage_value: Decimal | number | string;
  useful_life_months: number;
  in_service_at: Date;
  disposed_at?: Date | null;
  disposal_amount?: Decimal | number | string | null;
}

export interface ScheduleEntry {
  /** Primer día del mes, `YYYY-MM-01`, en la zona del negocio. */
  month: string;
  amount: Decimal;
}

const toDecimal = (v: Decimal | number | string | null | undefined) =>
  v === null || v === undefined ? new Decimal(0) : new Decimal(v);

/* Meses como entero (año·12 + mes−1) para poder sumar sin pelear con fechas. */
const monthIndexOf = (instant: Date, timeZone: string): number => {
  const [y, m] = dateKeyInZone(instant, timeZone).split('-').map(Number);
  return y * 12 + (m - 1);
};

const monthKey = (index: number): string => {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-01`;
};

export function monthlySchedule(
  asset: DepreciableAsset,
  timeZone: string = reportsTimeZone(),
): ScheduleEntry[] {
  const months = asset.useful_life_months;
  const base = toDecimal(asset.acquisition_cost).minus(
    toDecimal(asset.salvage_value),
  );
  if (months < 1 || base.lte(0)) return [];

  const quota = base
    .dividedBy(months)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const last = base.minus(quota.times(months - 1));

  const first = monthIndexOf(asset.in_service_at, timeZone) + 1;
  const stop = asset.disposed_at
    ? monthIndexOf(asset.disposed_at, timeZone)
    : Number.POSITIVE_INFINITY;

  const entries: ScheduleEntry[] = [];
  for (let i = 0; i < months; i++) {
    const index = first + i;
    if (index >= stop) break;
    entries.push({
      month: monthKey(index),
      amount: i === months - 1 ? last : quota,
    });
  }
  return entries;
}

/*
 * Un mes entra al rango si su día 1 cae dentro. Un rango que toma sólo parte de
 * un mes lleva la cuota completa si incluye el día 1 y nada si no: así, sumar
 * meses sueltos da lo mismo que pedir el rango entero, y nunca se cuenta un mes
 * dos veces ni se pierde.
 */
export function depreciationInRange(
  asset: DepreciableAsset,
  start: Date,
  end: Date,
  timeZone: string = reportsTimeZone(),
): Decimal {
  const from = dateKeyInZone(start, timeZone);
  const to = dateKeyInZone(end, timeZone);
  return monthlySchedule(asset, timeZone)
    .filter((e) => e.month >= from && e.month <= to)
    .reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
}

/* Depreciación acumulada de los meses cuyo día 1 ya llegó en `date`. */
export function accumulatedAt(
  asset: DepreciableAsset,
  date: Date,
  timeZone: string = reportsTimeZone(),
): Decimal {
  const upTo = dateKeyInZone(date, timeZone);
  return monthlySchedule(asset, timeZone)
    .filter((e) => e.month <= upTo)
    .reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
}

export function bookValueAt(
  asset: DepreciableAsset,
  date: Date,
  timeZone: string = reportsTimeZone(),
): Decimal {
  return toDecimal(asset.acquisition_cost).minus(
    accumulatedAt(asset, date, timeZone),
  );
}

/*
 * Ganancia (positiva) o pérdida (negativa) al dar de baja: lo recibido menos el
 * valor en libros al empezar el mes de la baja. Como el calendario ya se corta
 * en ese mes, ese valor es el costo menos todo lo depreciado. `null` si el
 * activo no se ha dado de baja.
 */
export function disposalResult(
  asset: DepreciableAsset,
  timeZone: string = reportsTimeZone(),
): Decimal | null {
  if (!asset.disposed_at) return null;
  const depreciated = monthlySchedule(asset, timeZone).reduce(
    (sum, e) => sum.plus(e.amount),
    new Decimal(0),
  );
  const bookValue = toDecimal(asset.acquisition_cost).minus(depreciated);
  return toDecimal(asset.disposal_amount).minus(bookValue);
}
