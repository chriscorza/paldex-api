import { toMoneyNumber } from '../../common/money';

export class TaxPaymentEntity {
  id: number;
  type: string;
  tax_id: string | null;
  fiscal_period_start: Date;
  fiscal_period_end: Date;
  due_date: Date | null;
  paid_at: Date | null;
  amount: number;
  account_id: number;
  status: string;
  notes: string | null;
  user_id: number;
  created_at: Date;

  constructor(partial: any) {
    this.id = partial.id;
    this.type = partial.type;
    this.tax_id = partial.tax_id ?? null;
    this.fiscal_period_start = partial.fiscal_period_start;
    this.fiscal_period_end = partial.fiscal_period_end;
    this.due_date = partial.due_date ?? null;
    this.paid_at = partial.paid_at ?? null;
    this.amount = toMoneyNumber(partial.amount) ?? 0;
    this.account_id = partial.account_id;
    this.status = partial.status;
    this.notes = partial.notes ?? null;
    this.user_id = partial.user_id;
    this.created_at = partial.created_at;
  }
}

export const TAX_PAYMENT_PUBLIC_SELECT = {
  id: true,
  type: true,
  tax_id: true,
  fiscal_period_start: true,
  fiscal_period_end: true,
  due_date: true,
  paid_at: true,
  amount: true,
  account_id: true,
  status: true,
  notes: true,
  user_id: true,
  created_at: true,
} as const;
