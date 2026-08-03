import { CategorySource } from '@prisma/client';

export interface CategoryResult {
  name: string | null;
  source: CategorySource;
}

/**
 * Resolve category for a Shopify product using chain of precedence:
 * override -> product_type -> collection -> tag -> UNKNOWN
 */
export function resolveCategory(
  override: string | null | undefined,
  productType: string | null | undefined,
  collections: string[] | null | undefined,
  tags: string[] | null | undefined,
): CategoryResult {
  if (override && override.trim().length > 0) {
    return { name: override.trim(), source: 'MANUAL' };
  }

  if (productType && productType.trim().length > 0) {
    return { name: productType.trim(), source: 'PRODUCT_TYPE' };
  }

  if (collections && Array.isArray(collections) && collections.length > 0) {
    const first = collections[0];
    if (first && typeof first === 'string' && first.trim().length > 0) {
      return { name: first.trim(), source: 'COLLECTION' };
    }
  }

  if (tags && Array.isArray(tags) && tags.length > 0) {
    const first = tags[0];
    if (first && typeof first === 'string' && first.trim().length > 0) {
      return { name: first.trim(), source: 'TAG' };
    }
  }

  return { name: null, source: 'UNKNOWN' };
}
