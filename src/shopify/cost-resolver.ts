export interface ResolvedCost {
  unit_cost: number | null;
  source: 'FROZEN' | 'PRODUCT_COST' | 'SKU_COST' | null;
}

/**
 * Resolve cost for a Shopify line item:
 * frozen cost -> ProductCost by variant_id -> ProductCost by sku -> no cost
 */
export function resolveLineItemCost(
  frozenCost: number | null | undefined,
  variantCosts: { unit_cost: number; effective_from: Date }[],
  skuCosts: { unit_cost: number; effective_from: Date }[],
  orderDate: Date,
): ResolvedCost {
  if (frozenCost !== null && frozenCost !== undefined) {
    return { unit_cost: frozenCost, source: 'FROZEN' };
  }

  const applicable = (
    costs: { unit_cost: number; effective_from: Date }[],
  ): number | null => {
    const valid = costs
      .filter((c) => c.effective_from <= orderDate)
      .sort((a, b) => b.effective_from.getTime() - a.effective_from.getTime());
    return valid.length > 0 ? valid[0].unit_cost : null;
  };

  const variantCost = applicable(variantCosts);
  if (variantCost !== null) {
    return { unit_cost: variantCost, source: 'PRODUCT_COST' };
  }

  const skuCost = applicable(skuCosts);
  if (skuCost !== null) {
    return { unit_cost: skuCost, source: 'SKU_COST' };
  }

  return { unit_cost: null, source: null };
}
