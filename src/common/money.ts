import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export function toMoneyNumber(
  d: Decimal | number | null | undefined,
): number | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Decimal) return d.toNumber();
  if (typeof d === 'number') return d;
  return Number(d);
}

export function toMoneyNumberOrNull(
  d: Decimal | number | null | undefined,
): number | null {
  return toMoneyNumber(d);
}

export function moneyNumber(d: Decimal | number): number {
  if (d instanceof Decimal) return d.toNumber();
  return d;
}

export function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function addMoney(a: Decimal | number, b: Decimal | number): Decimal {
  const da = a instanceof Decimal ? a : new Decimal(a);
  const db = b instanceof Decimal ? b : new Decimal(b);
  return Decimal.add(da, db);
}

export function subtractMoney(
  a: Decimal | number,
  b: Decimal | number,
): Decimal {
  const da = a instanceof Decimal ? a : new Decimal(a);
  const db = b instanceof Decimal ? b : new Decimal(b);
  return Decimal.sub(da, db);
}

export function multiplyMoney(
  a: Decimal | number,
  b: Decimal | number,
): Decimal {
  const da = a instanceof Decimal ? a : new Decimal(a);
  const db = b instanceof Decimal ? b : new Decimal(b);
  return Decimal.mul(da, db);
}

export function divideMoney(
  a: Decimal | number,
  b: Decimal | number,
): Decimal | null {
  const da = a instanceof Decimal ? a : new Decimal(a);
  const db = b instanceof Decimal ? b : new Decimal(b);
  if (db.isZero()) return null;
  return Decimal.div(da, db).toDP(2);
}

export function percentage(
  numerator: Decimal | number,
  denominator: Decimal | number,
): number | null {
  const da =
    denominator instanceof Decimal ? denominator : new Decimal(denominator);
  if (da.isZero()) return null;
  const dn = numerator instanceof Decimal ? numerator : new Decimal(numerator);
  return roundToCents(dn.dividedBy(da).times(100).toNumber());
}

export function zeroIfNull(d: Decimal | null): Decimal {
  return d ?? new Decimal(0);
}

export function decimalSum(values: (Decimal | number)[]): Decimal {
  let sum = new Decimal(0);
  for (const v of values) {
    sum = sum.add(v instanceof Decimal ? v : new Decimal(v));
  }
  return sum as unknown as Decimal;
}
