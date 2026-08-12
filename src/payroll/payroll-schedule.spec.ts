import { calculatePayDates } from './payroll-schedule';
import { monthRangeInZone } from '../common/timezone';

/*
 * Un vencimiento se construye como día del calendario, pero se guarda como
 * instante. Si ese instante se elige en UTC mientras los reportes recortan los
 * meses en la zona del negocio, el día 1 cae seis horas antes del inicio de su
 * propio mes y el gasto se cuenta en el anterior.
 */
describe('calculatePayDates — el día pertenece a su mes', () => {
  const enero = monthRangeInZone(2026, 1);

  const dentroDeEnero = (date: Date) =>
    date >= enero.startDate && date <= enero.endDate;

  it('coloca el día 1 dentro de su propio mes, no en el anterior', () => {
    const [periodo] = calculatePayDates(
      { frequency: 'MONTHLY', monthly_day: 1 },
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-31T23:59:59Z'),
    );

    expect(periodo.scheduled_pay_date.toISOString()).toBe(
      '2026-01-01T06:00:00.000Z',
    );
    expect(dentroDeEnero(periodo.scheduled_pay_date)).toBe(true);
  });

  it('mantiene el día que se pidió, no el de al lado', () => {
    const [periodo] = calculatePayDates(
      { frequency: 'MONTHLY', monthly_day: 6 },
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-31T23:59:59Z'),
    );

    expect(periodo.scheduled_pay_date.toISOString()).toBe(
      '2026-01-06T06:00:00.000Z',
    );
  });

  /* Febrero no tiene 31: el vencimiento se recorta al último día real. */
  it('respeta la longitud del mes', () => {
    const [periodo] = calculatePayDates(
      { frequency: 'MONTHLY', monthly_day: 31 },
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-02-28T23:59:59Z'),
    );

    expect(periodo.scheduled_pay_date.toISOString()).toBe(
      '2026-02-28T06:00:00.000Z',
    );
  });

  it('ancla igual los pagos quincenales', () => {
    const periodos = calculatePayDates(
      { frequency: 'BIWEEKLY', biweekly_first_day: 1, biweekly_second_day: 15 },
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-31T23:59:59Z'),
    );

    for (const periodo of periodos) {
      expect(periodo.scheduled_pay_date.toISOString()).toMatch(
        /T06:00:00\.000Z$/,
      );
    }
    expect(periodos.every((p) => dentroDeEnero(p.scheduled_pay_date))).toBe(
      true,
    );
  });
});
