import {
  accumulatedAt,
  bookValueAt,
  depreciationInRange,
  disposalResult,
  monthlySchedule,
  DepreciableAsset,
} from './depreciation';

const TZ = 'America/Mexico_City';

/* Mediodía en CDMX: lejos de cualquier borde de día. */
const day = (d: string) => new Date(`${d}T12:00:00-06:00`);

const asset = (
  overrides: Partial<DepreciableAsset> = {},
): DepreciableAsset => ({
  acquisition_cost: 12000,
  salvage_value: 0,
  useful_life_months: 12,
  in_service_at: day('2026-03-10'),
  ...overrides,
});

const n = (d: { toNumber(): number }) => d.toNumber();

describe('depreciation', () => {
  it('empieza el mes siguiente a la entrada en uso', () => {
    const a = asset();

    expect(
      n(depreciationInRange(a, day('2026-03-01'), day('2026-03-31'), TZ)),
    ).toBe(0);
    expect(
      n(depreciationInRange(a, day('2026-04-01'), day('2026-04-30'), TZ)),
    ).toBe(1000);
  });

  it('el último mes absorbe el residuo de redondeo', () => {
    const schedule = monthlySchedule(
      asset({ acquisition_cost: 10000, useful_life_months: 3 }),
      TZ,
    );

    expect(schedule.map((e) => n(e.amount))).toEqual([
      3333.33, 3333.33, 3333.34,
    ]);
    expect(schedule.map((e) => e.month)).toEqual([
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ]);
  });

  it('no deprecia después de agotar la vida útil', () => {
    const a = asset();

    expect(
      n(depreciationInRange(a, day('2027-04-01'), day('2027-12-31'), TZ)),
    ).toBe(0);
    expect(
      n(depreciationInRange(a, day('2026-01-01'), day('2027-12-31'), TZ)),
    ).toBe(12000);
  });

  it('respeta el valor residual', () => {
    const a = asset({ salvage_value: 2400 });

    expect(
      n(depreciationInRange(a, day('2026-04-01'), day('2026-04-30'), TZ)),
    ).toBe(800);
    expect(n(bookValueAt(a, day('2028-01-01'), TZ))).toBe(2400);
  });

  it('calcula acumulada y valor en libros', () => {
    const a = asset();
    /* Abril, mayo, junio y julio ya empezaron el 15 de julio. */
    expect(n(accumulatedAt(a, day('2026-07-15'), TZ))).toBe(4000);
    expect(n(bookValueAt(a, day('2026-07-15'), TZ))).toBe(8000);
  });

  it('una baja detiene la depreciación desde ese mes y da ganancia o pérdida', () => {
    /* Abril–julio depreciados (4,000): valor en libros 8,000, se vende en 5,000. */
    const a = asset({ disposed_at: day('2026-08-20'), disposal_amount: 5000 });

    expect(
      n(depreciationInRange(a, day('2026-08-01'), day('2026-12-31'), TZ)),
    ).toBe(0);
    expect(n(disposalResult(a, TZ)!)).toBe(-3000);
  });

  it('sin baja no hay resultado de baja', () => {
    expect(disposalResult(asset(), TZ)).toBeNull();
  });

  it('un rango parcial cuenta el mes completo sólo si incluye su día 1', () => {
    const a = asset();

    expect(
      n(depreciationInRange(a, day('2026-04-01'), day('2026-04-10'), TZ)),
    ).toBe(1000);
    expect(
      n(depreciationInRange(a, day('2026-04-02'), day('2026-04-30'), TZ)),
    ).toBe(0);
  });

  it('sumar meses sueltos da lo mismo que el rango completo', () => {
    const a = asset({ acquisition_cost: 10000, useful_life_months: 7 });
    const months = ['04', '05', '06', '07', '08', '09', '10', '11'];

    const byMonth = months
      .map((m) =>
        n(depreciationInRange(a, day(`2026-${m}-01`), day(`2026-${m}-28`), TZ)),
      )
      .reduce((s, v) => s + v, 0);
    const whole = n(
      depreciationInRange(a, day('2026-04-01'), day('2026-11-30'), TZ),
    );

    expect(Math.round(byMonth * 100) / 100).toBe(whole);
    expect(whole).toBe(10000);
  });

  /* 31 de marzo 20:00 en CDMX ya es 1 de abril en UTC: el activo entró en marzo. */
  it('cuenta el mes en la zona del negocio, no en UTC', () => {
    const a = asset({ in_service_at: new Date('2026-03-31T20:00:00-06:00') });

    expect(monthlySchedule(a, TZ)[0].month).toBe('2026-04-01');
  });
});
