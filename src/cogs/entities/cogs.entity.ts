import { toMoneyNumber } from '../../common/money';

export class CogsEntity {
  id: number;
  income_id: number;
  product_reference: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  source: string;
  notes: string | null;
  created_at: Date;

  constructor(partial: any) {
    this.id = partial.id;
    this.income_id = partial.income_id;
    this.product_reference = partial.product_reference ?? null;
    this.quantity = toMoneyNumber(partial.quantity) ?? 0;
    this.unit_cost = toMoneyNumber(partial.unit_cost) ?? 0;
    this.total_cost = toMoneyNumber(partial.total_cost) ?? 0;
    this.source = partial.source;
    this.notes = partial.notes ?? null;
    this.created_at = partial.created_at;
  }
}

export const COGS_PUBLIC_SELECT = {
  id: true,
  income_id: true,
  product_reference: true,
  quantity: true,
  unit_cost: true,
  total_cost: true,
  source: true,
  notes: true,
  created_at: true,
} as const;
