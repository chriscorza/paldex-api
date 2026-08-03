import { ExpenseCategory, ExpenseCategoryType } from '@prisma/client';

export class ExpenseCategoryEntity implements Partial<ExpenseCategory> {
  id: number;
  name: string;
  type: ExpenseCategoryType;
  is_system: boolean;
  affects_gross_profit: boolean;
  affects_operating_profit: boolean;
  is_cash_outflow: boolean;
  user_id: number | null;
  created_at: Date;

  constructor(partial: Partial<ExpenseCategory>) {
    Object.assign(this, partial);
  }
}

export const EXPENSE_CATEGORY_PUBLIC_SELECT = {
  id: true,
  name: true,
  type: true,
  is_system: true,
  affects_gross_profit: true,
  affects_operating_profit: true,
  is_cash_outflow: true,
  user_id: true,
  created_at: true,
} as const;

export interface PaginatedExpenseCategoryResponse {
  data: ExpenseCategoryEntity[];
  total: number;
  page: number;
  limit: number;
}
