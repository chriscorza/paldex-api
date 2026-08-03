import { calculatePayDates, calculateDueDates } from '../payroll-schedule';

describe('calculatePayDates', () => {
  describe('WEEKLY', () => {
    it('should generate weekly pay dates within range', () => {
      const periods = calculatePayDates(
        { frequency: 'WEEKLY', weekly_day: 5 },
        new Date(2026, 0, 1),
        new Date(2026, 0, 31),
      );
      expect(periods.length).toBeGreaterThanOrEqual(4);
      for (const p of periods) {
        expect(p.scheduled_pay_date.getDay()).toBe(5);
      }
    });

    it('should have period of 7 days ending on pay date', () => {
      const periods = calculatePayDates(
        { frequency: 'WEEKLY', weekly_day: 1 },
        new Date(2026, 0, 1),
        new Date(2026, 0, 31),
      );
      expect(periods.length).toBeGreaterThanOrEqual(4);
      for (const p of periods) {
        const diff = (p.period_end.getTime() - p.period_start.getTime()) / (1000 * 60 * 60 * 24);
        expect(diff).toBe(6);
      }
    });
  });

  describe('BIWEEKLY', () => {
    it('should generate two dates per month', () => {
      const periods = calculatePayDates(
        { frequency: 'BIWEEKLY', biweekly_first_day: 15, biweekly_second_day: 30 },
        new Date(2026, 0, 1),
        new Date(2026, 2, 31),
      );
      expect(periods.length).toBe(6);
    });

    it('should clamp day 31 in April to 30', () => {
      const periods = calculatePayDates(
        { frequency: 'BIWEEKLY', biweekly_first_day: 15, biweekly_second_day: 31 },
        new Date(2026, 3, 1),
        new Date(2026, 3, 30),
      );
      expect(periods[periods.length - 1].scheduled_pay_date.getDate()).toBe(30);
    });

    it('should clamp day 30 in February to 28', () => {
      const periods = calculatePayDates(
        { frequency: 'BIWEEKLY', biweekly_first_day: 15, biweekly_second_day: 30 },
        new Date(2026, 1, 1),
        new Date(2026, 1, 28),
      );
      expect(periods[periods.length - 1].scheduled_pay_date.getDate()).toBe(28);
    });
  });

  describe('MONTHLY', () => {
    it('should generate one date per month', () => {
      const periods = calculatePayDates(
        { frequency: 'MONTHLY', monthly_day: 15 },
        new Date(2026, 0, 1),
        new Date(2026, 2, 31),
      );
      expect(periods.length).toBe(3);
    });

    it('should clamp day 31 in April to 30', () => {
      const periods = calculatePayDates(
        { frequency: 'MONTHLY', monthly_day: 31 },
        new Date(2026, 3, 1),
        new Date(2026, 3, 30),
      );
      expect(periods[0].scheduled_pay_date.getDate()).toBe(30);
    });

    it('should clamp day 30 in February to 28', () => {
      const periods = calculatePayDates(
        { frequency: 'MONTHLY', monthly_day: 30 },
        new Date(2026, 1, 1),
        new Date(2026, 1, 28),
      );
      expect(periods[0].scheduled_pay_date.getDate()).toBe(28);
    });

    it('should handle year crossover', () => {
      const periods = calculatePayDates(
        { frequency: 'MONTHLY', monthly_day: 15 },
        new Date(2026, 10, 1),
        new Date(2027, 1, 28),
      );
      expect(periods.length).toBe(4);
    });
  });

  describe('YEARLY', () => {
    it('should generate yearly dates', () => {
      const periods = calculatePayDates(
        { frequency: 'YEARLY', yearly_month: 12, yearly_day: 15 },
        new Date(2026, 0, 1),
        new Date(2028, 11, 31),
      );
      expect(periods.length).toBe(3);
    });
  });
});

describe('calculateDueDates', () => {
  it('should map pay dates to due dates', () => {
    const dates = calculateDueDates(
      { frequency: 'WEEKLY', weekly_day: 5 },
      new Date(2026, 0, 1),
      new Date(2026, 0, 31),
    );
    expect(dates.length).toBeGreaterThanOrEqual(4);
  });
});
