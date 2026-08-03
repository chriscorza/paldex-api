import { Tax } from '@prisma/client';

export interface TaxDetail extends Tax {
  incomes_count: number;
  expenses_count: number;
}

export interface PaginatedTaxResponse {
  data: Tax[];
  total: number;
  page: number;
  limit: number;
}
