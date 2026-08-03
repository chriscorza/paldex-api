import { toMoneyNumber } from '../../common/money';

export class ProductCostEntity {
  id: number;
  shopify_variant_id: string | null;
  sku: string | null;
  unit_cost: number;
  effective_from: Date;
  source: string;
  notes: string | null;
  user_id: number;
  created_at: Date;

  constructor(partial: any) {
    this.id = partial.id;
    this.shopify_variant_id = partial.shopify_variant_id ?? null;
    this.sku = partial.sku ?? null;
    this.unit_cost = toMoneyNumber(partial.unit_cost) ?? 0;
    this.effective_from = partial.effective_from;
    this.source = partial.source;
    this.notes = partial.notes ?? null;
    this.user_id = partial.user_id;
    this.created_at = partial.created_at;
  }
}

export const PRODUCT_COST_SELECT = {
  id: true,
  shopify_variant_id: true,
  sku: true,
  unit_cost: true,
  effective_from: true,
  source: true,
  notes: true,
  user_id: true,
  created_at: true,
} as const;
