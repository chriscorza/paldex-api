import { toMoneyNumber } from '../../common/money';

export class PayrollPaymentEntity {
  id: number;
  employee_id: number;
  period_start: Date;
  period_end: Date;
  scheduled_pay_date: Date;
  paid_at: Date | null;
  pay_frequency_snapshot: string;
  gross_amount: number;
  deductions: number;
  bonuses: number;
  net_amount: number;
  account_id: number | null;
  status: string;
  auto_generated: boolean;
  notes: string | null;
  created_at: Date;

  constructor(partial: any) {
    this.id = partial.id;
    this.employee_id = partial.employee_id;
    this.period_start = partial.period_start;
    this.period_end = partial.period_end;
    this.scheduled_pay_date = partial.scheduled_pay_date;
    this.paid_at = partial.paid_at ?? null;
    this.pay_frequency_snapshot = partial.pay_frequency_snapshot;
    this.gross_amount = toMoneyNumber(partial.gross_amount) ?? 0;
    this.deductions = toMoneyNumber(partial.deductions) ?? 0;
    this.bonuses = toMoneyNumber(partial.bonuses) ?? 0;
    this.net_amount = toMoneyNumber(partial.net_amount) ?? 0;
    this.account_id = partial.account_id ?? null;
    this.status = partial.status;
    this.auto_generated = partial.auto_generated;
    this.notes = partial.notes ?? null;
    this.created_at = partial.created_at;
  }
}

export const PAYROLL_PUBLIC_SELECT = {
  id: true,
  employee_id: true,
  period_start: true,
  period_end: true,
  scheduled_pay_date: true,
  paid_at: true,
  pay_frequency_snapshot: true,
  gross_amount: true,
  deductions: true,
  bonuses: true,
  net_amount: true,
  account_id: true,
  status: true,
  auto_generated: true,
  notes: true,
  created_at: true,
} as const;
