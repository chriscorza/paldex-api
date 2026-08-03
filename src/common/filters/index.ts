export function buildDateRangeFilter(
  start_date?: string,
  end_date?: string,
): { date?: { gte?: Date; lte?: Date } } | undefined {
  if (!start_date && !end_date) return undefined;
  const date: { gte?: Date; lte?: Date } = {};
  if (start_date) date.gte = new Date(start_date);
  if (end_date) date.lte = new Date(end_date);
  return { date };
}

export function buildSearchFilter(
  search?: string,
): { concept?: { contains: string } } | undefined {
  if (!search) return undefined;
  return { concept: { contains: search } };
}

export function buildOrderBy(
  sort_by?: string,
  order?: string,
  defaultSortBy = 'created_at',
  defaultOrder: 'asc' | 'desc' = 'desc',
): Record<string, string> {
  return { [sort_by ?? defaultSortBy]: order ?? defaultOrder };
}

export function buildPagination(
  page?: number,
  limit?: number,
): { skip: number; take: number; page: number; limit: number } {
  const p = page ?? 1;
  const l = limit ?? 20;
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): { data: T[]; total: number; page: number; limit: number } {
  return { data, total, page, limit };
}
