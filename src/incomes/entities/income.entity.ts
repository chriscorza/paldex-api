import { toMoneyNumber } from '../../common/money';

export class IncomeTaxEntity {
  tax_id: number;
  income_id: number;
  tax: { id: number; name: string; rate: number; created_at: Date };
}

export class IncomeEntity {
  id: number;
  amount: number;
  concept: string;
  date: Date;
  invoiced: boolean;
  account_id: number;
  created_at: Date;
  source: string | null;
  external_reference: string | null;
  income_type: string;
  channel: string | null;
  gross_amount: number | null;
  discount_total: number | null;
  fee_total: number | null;
  shipping_charged: number | null;
  shipping_cost: number | null;
  net_amount: number | null;
  cogs_total: number | null;
  profit_gross: number | null;
  taxes: IncomeTaxEntity[];

  constructor(partial: any) {
    this.id = partial.id;
    this.amount = toMoneyNumber(partial.amount) ?? 0;
    this.concept = partial.concept;
    this.date = partial.date;
    this.invoiced = partial.invoiced;
    this.account_id = partial.account_id;
    this.created_at = partial.created_at;
    this.source = partial.source ?? null;
    this.external_reference = partial.external_reference ?? null;
    this.income_type = partial.income_type;
    this.channel = partial.channel ?? null;
    this.gross_amount = toMoneyNumber(partial.gross_amount);
    this.discount_total = toMoneyNumber(partial.discount_total);
    this.fee_total = toMoneyNumber(partial.fee_total);
    this.shipping_charged = toMoneyNumber(partial.shipping_charged);
    this.shipping_cost = toMoneyNumber(partial.shipping_cost);
    this.net_amount = toMoneyNumber(partial.net_amount);
    this.cogs_total = toMoneyNumber(partial.cogs_total);
    this.profit_gross = toMoneyNumber(partial.profit_gross);
    this.taxes = partial.taxes ?? [];
  }
}

export const INCOME_PUBLIC_SELECT = {
  id: true,
  amount: true,
  concept: true,
  date: true,
  invoiced: true,
  account_id: true,
  created_at: true,
  source: true,
  external_reference: true,
  income_type: true,
  channel: true,
  gross_amount: true,
  discount_total: true,
  fee_total: true,
  shipping_charged: true,
  shipping_cost: true,
  net_amount: true,
  cogs_total: true,
  profit_gross: true,
  taxes: { include: { tax: true } },
} as const;

export class PaginatedIncomeResponse {
  data: IncomeEntity[];
  total: number;
  page: number;
  limit: number;
}
