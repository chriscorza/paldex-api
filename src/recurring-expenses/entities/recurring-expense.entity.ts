import { toMoneyNumber } from '../../common/money';

export class RecurringExpenseEntity {
  id: number;
  concept: string;
  amount: number;
  category_id: number;
  account_id: number | null;
  frequency: string;
  due_day_of_week: number | null;
  due_day_of_month: number | null;
  second_due_day_of_month: number | null;
  start_date: Date;
  end_date: Date | null;
  active: boolean;
  auto_generate: boolean;
  requires_confirmation: boolean;
  invoice_status: string;
  /* Porcentaje, no fracción: 16 es 16 %. */
  tax_rate: number | null;
  notes: string | null;
  user_id: number;
  created_at: Date;

  constructor(partial: any) {
    Object.assign(this, partial);
    this.amount = toMoneyNumber(partial.amount) ?? 0;
    this.tax_rate =
      partial.tax_rate === null || partial.tax_rate === undefined
        ? null
        : Number(partial.tax_rate);
  }
}

export const RECURRING_SELECT = {
  id: true,
  concept: true,
  amount: true,
  category_id: true,
  account_id: true,
  frequency: true,
  due_day_of_week: true,
  due_day_of_month: true,
  second_due_day_of_month: true,
  start_date: true,
  end_date: true,
  active: true,
  auto_generate: true,
  requires_confirmation: true,
  invoice_status: true,
  tax_rate: true,
  notes: true,
  user_id: true,
  created_at: true,
} as const;
