import { toMoneyNumber, percentage, roundToCents } from '../money';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

describe('toMoneyNumber', () => {
  it('should convert Decimal to number', () => {
    expect(toMoneyNumber(new Decimal('89.90'))).toBe(89.9);
  });

  it('should handle null', () => {
    expect(toMoneyNumber(null)).toBeNull();
  });

  it('should handle undefined', () => {
    expect(toMoneyNumber(undefined)).toBeNull();
  });

  it('should handle plain number', () => {
    expect(toMoneyNumber(42)).toBe(42);
  });

  it('should handle 0', () => {
    expect(toMoneyNumber(0)).toBe(0);
  });

  it('should handle negative numbers', () => {
    expect(toMoneyNumber(-100.5)).toBe(-100.5);
  });

  it('should convert string number', () => {
    expect(toMoneyNumber('123.45' as any)).toBe(123.45);
  });
});

describe('percentage', () => {
  it('should calculate percentage correctly', () => {
    expect(percentage(25, 100)).toBe(25);
  });

  it('should return null when denominator is zero', () => {
    expect(percentage(50, 0)).toBeNull();
  });

  it('should return null when denominator is zero as Decimal', () => {
    expect(percentage(50, new Decimal(0))).toBeNull();
  });

  it('should return 0 when numerator is 0', () => {
    expect(percentage(0, 100)).toBe(0);
  });

  it('should handle Decimal values', () => {
    expect(percentage(new Decimal(33), new Decimal(100))).toBe(33);
  });

  it('should round to two decimal places', () => {
    expect(percentage(1, 3)).toBe(33.33);
  });
});

describe('roundToCents', () => {
  it('should round to two decimals', () => {
    expect(roundToCents(10.555)).toBe(10.56);
    expect(roundToCents(10.554)).toBe(10.55);
  });
});
