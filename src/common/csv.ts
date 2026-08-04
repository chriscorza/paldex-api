export function escapeCsvField(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'number' ? value.toFixed(2) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
