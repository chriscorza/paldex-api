import { toMoneyNumber } from '../../common/money';

export class ExpenseTaxEntity {
  tax_id: number;
  expense_id: number;
  tax: { id: number; name: string; rate: number; created_at: Date };
}

export class ExpenseCategorySummaryEntity {
  id: number;
  name: string;
  type: string;
}

export class ExpenseEntity {
  id: number;
  amount: number;
  concept: string;
  date: Date;
  invoiced: boolean;
  account_id: number;
  created_at: Date;
  user_id: number;
  category_id: number | null;
  vendor: string | null;
  status: string;
  paid_at: Date | null;
  invoice_status: string;
  invoice_uuid: string | null;
  supplier_rfc: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  withholding_amount: number | null;
  is_tax_deductible: boolean;
  tax_creditable_amount: number | null;
  taxes: ExpenseTaxEntity[];
  category: ExpenseCategorySummaryEntity | null;

  constructor(partial: any) {
    this.id = partial.id;
    this.amount = toMoneyNumber(partial.amount) ?? 0;
    this.concept = partial.concept;
    this.date = partial.date;
    this.invoiced = partial.invoiced;
    this.account_id = partial.account_id;
    this.created_at = partial.created_at;
    this.user_id = partial.user_id;
    this.category_id = partial.category_id ?? null;
    this.vendor = partial.vendor ?? null;
    this.status = partial.status;
    this.paid_at = partial.paid_at ?? null;
    this.invoice_status = partial.invoice_status;
    this.invoice_uuid = partial.invoice_uuid ?? null;
    this.supplier_rfc = partial.supplier_rfc ?? null;
    this.subtotal = toMoneyNumber(partial.subtotal);
    this.tax_amount = toMoneyNumber(partial.tax_amount);
    this.withholding_amount = toMoneyNumber(partial.withholding_amount);
    this.is_tax_deductible = partial.is_tax_deductible;
    this.tax_creditable_amount = toMoneyNumber(partial.tax_creditable_amount);
    this.taxes = partial.taxes ?? [];
    this.category = partial.category
      ? {
          id: partial.category.id,
          name: partial.category.name,
          type: partial.category.type,
        }
      : null;
  }
}

export const EXPENSE_PUBLIC_INCLUDE = {
  taxes: { include: { tax: true } },
  category: { select: { id: true, name: true, type: true } },
} as const;

export interface PaginatedExpenseResponse {
  data: ExpenseEntity[];
  total: number;
  page: number;
  limit: number;
}
