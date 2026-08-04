export interface PayrollPeriod {
  period_start: Date;
  period_end: Date;
  scheduled_pay_date: Date;
}

export interface DueDate {
  scheduled_due_date: Date;
}

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';

export function calculatePayDates(
  config: {
    frequency: Frequency;
    weekly_day?: number | null;
    biweekly_first_day?: number | null;
    biweekly_second_day?: number | null;
    monthly_day?: number | null;
    yearly_month?: number | null;
    yearly_day?: number | null;
  },
  rangeStart: Date,
  rangeEnd: Date,
): PayrollPeriod[] {
  switch (config.frequency) {
    case 'WEEKLY':
      return calculateWeekly(config.weekly_day!, rangeStart, rangeEnd);
    case 'BIWEEKLY':
      return calculateBiweekly(
        config.biweekly_first_day!,
        config.biweekly_second_day!,
        rangeStart,
        rangeEnd,
      );
    case 'MONTHLY':
      return calculateMonthly(config.monthly_day!, rangeStart, rangeEnd);
    case 'YEARLY':
      return calculateYearly(
        config.yearly_month!,
        config.yearly_day!,
        rangeStart,
        rangeEnd,
      );
    default:
      return [];
  }
}

export function calculateDueDates(
  config: {
    frequency: Frequency;
    weekly_day?: number | null;
    biweekly_first_day?: number | null;
    biweekly_second_day?: number | null;
    monthly_day?: number | null;
    yearly_month?: number | null;
    yearly_day?: number | null;
  },
  rangeStart: Date,
  rangeEnd: Date,
): DueDate[] {
  return calculatePayDates(config, rangeStart, rangeEnd).map((p) => ({
    scheduled_due_date: p.scheduled_pay_date,
  }));
}

function calculateWeekly(
  payDayOfWeek: number,
  rangeStart: Date,
  rangeEnd: Date,
): PayrollPeriod[] {
  const periods: PayrollPeriod[] = [];
  const current = new Date(rangeStart);
  current.setHours(0, 0, 0, 0);

  while (current <= rangeEnd) {
    const targetDay = payDayOfWeek % 7;
    const daysUntilTarget = (targetDay - current.getDay() + 7) % 7;
    const payDate = new Date(current);
    payDate.setDate(payDate.getDate() + daysUntilTarget);

    if (payDate > rangeEnd) break;

    const periodEnd = new Date(payDate);
    const periodStart = new Date(payDate);
    periodStart.setDate(periodStart.getDate() - 6);

    periods.push({
      period_start: periodStart,
      period_end: periodEnd,
      scheduled_pay_date: payDate,
    });
    current.setDate(payDate.getDate() + 1);
  }

  return periods;
}

function calculateBiweekly(
  firstDay: number,
  secondDay: number,
  rangeStart: Date,
  rangeEnd: Date,
): PayrollPeriod[] {
  const periods: PayrollPeriod[] = [];
  const startMonth = rangeStart.getMonth();
  const startYear = rangeStart.getFullYear();
  const endMonth = rangeEnd.getMonth();
  const endYear = rangeEnd.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const monthStart = year === startYear ? startMonth : 0;
    const monthEnd = year === endYear ? endMonth : 11;
    for (let month = monthStart; month <= monthEnd; month++) {
      for (const day of [firstDay, secondDay]) {
        const payDate = resolveDayInMonth(year, month, day);
        if (payDate < rangeStart || payDate > rangeEnd) continue;
        const periodStart = new Date(payDate);
        periodStart.setDate(periodStart.getDate() - 14);
        periods.push({
          period_start: periodStart,
          period_end: payDate,
          scheduled_pay_date: payDate,
        });
      }
    }
  }

  return periods;
}

function calculateMonthly(
  monthlyDay: number,
  rangeStart: Date,
  rangeEnd: Date,
): PayrollPeriod[] {
  const periods: PayrollPeriod[] = [];
  const startMonth = rangeStart.getMonth();
  const startYear = rangeStart.getFullYear();
  const endMonth = rangeEnd.getMonth();
  const endYear = rangeEnd.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const monthStart = year === startYear ? startMonth : 0;
    const monthEnd = year === endYear ? endMonth : 11;
    for (let month = monthStart; month <= monthEnd; month++) {
      const payDate = resolveDayInMonth(year, month, monthlyDay);
      if (payDate < rangeStart || payDate > rangeEnd) continue;
      const periodStart = new Date(payDate);
      periodStart.setMonth(periodStart.getMonth() - 1);
      periods.push({
        period_start: periodStart,
        period_end: payDate,
        scheduled_pay_date: payDate,
      });
    }
  }

  return periods;
}

function calculateYearly(
  month: number,
  day: number,
  rangeStart: Date,
  rangeEnd: Date,
): PayrollPeriod[] {
  const periods: PayrollPeriod[] = [];
  const startYear = rangeStart.getFullYear();
  const endYear = rangeEnd.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const payDate = resolveDayInMonth(year, month - 1, day);
    if (payDate < rangeStart || payDate > rangeEnd) continue;
    const periodStart = new Date(payDate);
    periodStart.setFullYear(periodStart.getFullYear() - 1);
    periods.push({
      period_start: periodStart,
      period_end: payDate,
      scheduled_pay_date: payDate,
    });
  }

  return periods;
}

function resolveDayInMonth(year: number, month: number, day: number): Date {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const effectiveDay = Math.min(day, daysInMonth);
  return new Date(year, month, effectiveDay);
}
