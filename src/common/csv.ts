export function toCsv(rows: Record<string, any>[], delimiter = ','): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const bom = '\uFEFF';

  const escape = (v: any): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? v.toFixed(2) : String(v);
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headerLine = bom + headers.map(escape).join(delimiter);
  const dataLines = rows.map((row) => headers.map((h) => escape(row[h])).join(delimiter));
  return [headerLine, ...dataLines].join('\n');
}

export function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v.toFixed(2);
}

export function formatDate(v: Date | string | null): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toISOString().split('T')[0];
}
