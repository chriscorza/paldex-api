import { Injectable } from '@nestjs/common';
// pdfkit es CommonJS (`module.exports = PDFDocument`) y el proyecto no usa esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- ver arriba
import PDFDocument = require('pdfkit');
import { reportsTimeZone } from '../common/timezone';
import {
  IncomeStatementEntity,
  IncomeStatementLineEntity,
} from './entities/income-statement.entity';

/*
 * El estado de resultados en PDF, para leerse impreso o mandarse por correo a
 * alguien que no usa Paldex (el contador, un socio, el banco).
 *
 * Se arma en dos pasos: `buildRows` decide QUÉ va en cada renglón (función pura,
 * con pruebas) y `render` sólo lo dibuja. Así la lógica de presentación —qué se
 * oculta, cómo se firman los montos— no queda enterrada entre coordenadas.
 *
 * Convenciones del documento:
 * - Lo que resta va entre paréntesis, como en contabilidad: (20,000.00). Un
 *   subtotal negativo también, y en rojo. No se usa el signo menos tipográfico:
 *   las fuentes estándar del PDF (WinAnsi) no lo traen.
 * - Cada renglón lleva su porcentaje sobre ventas netas, no sólo los
 *   subtotales: es lo que deja comparar un gasto contra el tamaño del negocio.
 * - Los desgloses en cero se omiten; los renglones principales nunca, para que
 *   la estructura sea la misma en todos los periodos.
 */

export type PdfRowStyle =
  'section' | 'detail' | 'subtotal' | 'highlight' | 'result';

export interface PdfRow {
  key: string;
  label: string;
  amount: string;
  percent: string;
  style: PdfRowStyle;
  negative: boolean;
}

export interface PdfMeta {
  businessName: string;
  generatedAt: Date;
}

/* Renglones que restan en la cascada: su monto viene en positivo. */
const SUBTRACTED = new Set([
  'cost_of_sales',
  'operating_expenses',
  'payroll',
  'depreciation_amortization',
  'interest',
  'income_tax',
]);

/* Los dos números que el lector busca primero. */
const HIGHLIGHTED = new Set(['ebitda']);
const RESULT = new Set(['net_income']);

const number = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatAmount = (value: number, subtract: boolean): string => {
  const shown = number.format(Math.abs(value));
  const negative = subtract ? value !== 0 : value < 0;
  return negative ? `(${shown})` : shown;
};

export const formatPercent = (value: number, base: number): string => {
  if (base === 0) return '';
  const pct = (value / base) * 100;
  return `${pct.toLocaleString('es-MX', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
};

export const formatMoney = (value: number): string =>
  `${value < 0 ? '-' : ''}$${number.format(Math.abs(value))}`;

/* `YYYY-MM-DD` -> "1 de abril de 2026". Al mediodía UTC para que ninguna zona lo mueva de día. */
export const formatDay = (day: string): string =>
  new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));

/*
 * Un mes calendario completo se nombra como mes ("Octubre de 2026"): es como lo
 * piensa quien lo lee. Cualquier otro rango, con sus dos fechas.
 */
export const formatPeriod = (start: string, end: string): string => {
  const [y, m, d] = start.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (
    d === 1 &&
    end === `${start.slice(0, 8)}${String(lastDay).padStart(2, '0')}`
  ) {
    const month = new Intl.DateTimeFormat('es-MX', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${start}T12:00:00Z`));
    return month.charAt(0).toUpperCase() + month.slice(1);
  }
  return `Del ${formatDay(start)} al ${formatDay(end)}`;
};

export function buildRows(statement: IncomeStatementEntity): PdfRow[] {
  const base = statement.summary.net_sales;
  const rows: PdfRow[] = [];

  const push = (
    line: IncomeStatementLineEntity,
    style: PdfRowStyle,
    subtract: boolean,
  ) => {
    rows.push({
      key: line.key,
      label: line.label,
      amount: formatAmount(line.amount, subtract),
      percent: formatPercent(line.amount, base),
      style,
      negative: subtract ? false : line.amount < 0,
    });
  };

  for (const line of statement.lines) {
    if (line.kind === 'subtotal') {
      const style = RESULT.has(line.key)
        ? 'result'
        : HIGHLIGHTED.has(line.key)
          ? 'highlight'
          : 'subtotal';
      push(line, style, false);
      continue;
    }

    /* Sin bajas de activos en el periodo, ese renglón sólo es ruido. */
    if (line.key === 'other_results' && line.amount === 0) continue;

    push(line, 'section', SUBTRACTED.has(line.key));
    for (const child of line.children ?? []) {
      if (child.amount === 0) continue;
      push(child, 'detail', false);
    }
  }
  return rows;
}

const CASH_LABELS: [keyof IncomeStatementEntity['cash_items'], string][] = [
  ['vat_paid', 'IVA enterado al SAT'],
  ['asset_purchases', 'Compra de activos fijos'],
  ['asset_sales', 'Venta de activos fijos (entrada)'],
  ['inventory_purchases', 'Compras de inventario'],
  ['debt_principal_paid', 'Pago de capital de préstamos'],
  ['owner_withdrawals', 'Retiros del dueño'],
  ['reinvestment', 'Reinversión'],
  ['other_non_operating', 'Otras salidas no operativas'],
];

export function buildCashRows(
  statement: IncomeStatementEntity,
): { label: string; amount: string }[] {
  return CASH_LABELS.filter(([key]) => statement.cash_items[key] !== 0).map(
    ([key, label]) => ({
      label,
      amount: formatMoney(statement.cash_items[key]),
    }),
  );
}

export function buildNotes(statement: IncomeStatementEntity): string[] {
  const notes: string[] = [];
  const q = statement.quality;
  if (q.incomplete_cost_data) {
    notes.push(
      `Sólo el ${q.cost_data_coverage ?? 0}% de las ventas tiene costo capturado ` +
        `(${q.sales_without_cost} sin costo). La utilidad bruta y todo lo que está debajo ` +
        'pueden ser menores a lo que se muestra.',
    );
  }
  for (const warning of statement.warnings) notes.push(warning.message);
  if (statement.cash_items.other_non_operating !== 0) {
    notes.push(
      'Hay gastos en categorías que no afectan la operación ni encajan en otro renglón. ' +
        'Conviene revisar esas categorías.',
    );
  }
  return notes;
}

const GLOSSARY: [string, string][] = [
  [
    'Utilidad bruta',
    'lo que queda de las ventas después de pagar la mercancía vendida, las comisiones y los envíos.',
  ],
  [
    'EBITDA',
    'lo que genera la operación antes de intereses, impuestos, depreciación y amortización. ' +
      'Sirve para comparar el negocio sin importar cómo se financió ni cuánto equipo tiene.',
  ],
  [
    'Depreciación',
    'el costo de los activos fijos repartido mes a mes a lo largo de su vida útil. No es una salida de dinero del periodo.',
  ],
  [
    'Utilidad operativa (EBIT)',
    'el EBITDA menos la depreciación y la amortización.',
  ],
  ['Utilidad neta', 'lo que gana el negocio después de intereses e ISR.'],
];

/* ---- Dibujo ---- */

const PAGE = { width: 612, height: 792, margin: 50 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const BOTTOM = PAGE.height - PAGE.margin - 30;

const COLOR = {
  ink: '#1f2937',
  muted: '#6b7280',
  rule: '#d1d5db',
  accent: '#2e7de9',
  accentDark: '#1e4f99',
  subtotalFill: '#f3f4f6',
  highlightFill: '#e8f0fd',
  resultFill: '#1e4f99',
  negative: '#b91c1c',
};

/* Todas las columnas con el mismo relleno interior, haya fondo o no: así alinean. */
const PAD = 8;
const COL = {
  label: PAGE.margin + PAD,
  detail: PAGE.margin + PAD + 18,
  amountRight: PAGE.margin + CONTENT_WIDTH - 80,
  percentRight: PAGE.margin + CONTENT_WIDTH - PAD,
};

@Injectable()
export class IncomeStatementPdfService {
  render(statement: IncomeStatementEntity, meta: PdfMeta): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: `Estado de resultados ${statement.period.start_date} a ${statement.period.end_date}`,
        Author: meta.businessName,
        Creator: 'Paldex',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    let y = this.header(doc, statement, meta);
    y = this.kpis(doc, statement, y + 18);
    y = this.table(doc, buildRows(statement), y + 24);
    y = this.cashBlock(doc, buildCashRows(statement), y + 24);
    y = this.notesBlock(doc, buildNotes(statement), y + 20);
    this.glossary(doc, y + 20);
    this.footers(doc, statement);

    doc.end();
    return done;
  }

  private header(
    doc: PDFKit.PDFDocument,
    statement: IncomeStatementEntity,
    meta: PdfMeta,
  ): number {
    const top = PAGE.margin;
    doc.rect(0, 0, PAGE.width, 6).fill(COLOR.accent);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLOR.accent)
      .text('ESTADO DE RESULTADOS', PAGE.margin, top, {
        characterSpacing: 1.2,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(COLOR.ink)
      .text(meta.businessName, PAGE.margin, top + 14, {
        width: CONTENT_WIDTH * 0.62,
      });
    const afterName = doc.y;
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(COLOR.muted)
      .text(
        formatPeriod(statement.period.start_date, statement.period.end_date),
        PAGE.margin,
        afterName + 2,
      );
    const leftBottom = doc.y;

    const generated = new Intl.DateTimeFormat('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: reportsTimeZone(),
    }).format(meta.generatedAt);
    const rightX = PAGE.margin + CONTENT_WIDTH * 0.62;
    const rightW = CONTENT_WIDTH * 0.38;
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLOR.muted)
      .text('Base de efectivo', rightX, top + 16, {
        width: rightW,
        align: 'right',
      })
      .text('Cifras en pesos mexicanos (MXN)', {
        width: rightW,
        align: 'right',
      })
      .text(`Generado el ${generated}`, { width: rightW, align: 'right' });

    const bottom = Math.max(leftBottom, doc.y) + 12;
    doc
      .moveTo(PAGE.margin, bottom)
      .lineTo(PAGE.margin + CONTENT_WIDTH, bottom)
      .lineWidth(0.75)
      .strokeColor(COLOR.rule)
      .stroke();
    return bottom;
  }

  private kpis(
    doc: PDFKit.PDFDocument,
    statement: IncomeStatementEntity,
    top: number,
  ): number {
    const s = statement.summary;
    /* El margen se calcula igual que la columna "% ventas", para que la tarjeta y la tabla digan lo mismo. */
    const cards: [string, number, boolean][] = [
      ['Ventas netas', s.net_sales, false],
      ['Utilidad bruta', s.gross_profit, true],
      ['EBITDA', s.ebitda, true],
      ['Utilidad neta', s.net_income, true],
    ];
    const gap = 10;
    const width = (CONTENT_WIDTH - gap * 3) / 4;
    const height = 62;

    cards.forEach(([label, value, withMargin], i) => {
      const margin = withMargin ? formatPercent(value, s.net_sales) : '';
      const x = PAGE.margin + i * (width + gap);
      const strong = label === 'EBITDA';
      doc
        .roundedRect(x, top, width, height, 6)
        .fill(strong ? COLOR.highlightFill : COLOR.subtotalFill);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLOR.muted)
        .text(label.toUpperCase(), x + 10, top + 10, {
          width: width - 20,
          characterSpacing: 0.6,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(value < 0 ? COLOR.negative : COLOR.ink)
        .text(formatMoney(value), x + 10, top + 24, {
          width: width - 20,
          lineBreak: false,
        });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLOR.muted)
        .text(
          !withMargin
            ? 'Base de los porcentajes'
            : margin
              ? `${margin} de las ventas`
              : '',
          x + 10,
          top + 44,
          { width: width - 20 },
        );
    });
    return top + height;
  }

  private tableHeader(doc: PDFKit.PDFDocument, top: number): number {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text('CONCEPTO', COL.label, top, { characterSpacing: 0.6 })
      .text('MONTO', COL.amountRight - 110, top, {
        width: 110,
        align: 'right',
        characterSpacing: 0.6,
      })
      .text('% VENTAS', COL.percentRight - 70, top, {
        width: 70,
        align: 'right',
        characterSpacing: 0.6,
      });
    const bottom = top + 14;
    doc
      .moveTo(PAGE.margin, bottom)
      .lineTo(PAGE.margin + CONTENT_WIDTH, bottom)
      .lineWidth(1)
      .strokeColor(COLOR.ink)
      .stroke();
    return bottom + 4;
  }

  private table(doc: PDFKit.PDFDocument, rows: PdfRow[], top: number): number {
    let y = this.tableHeader(doc, top);

    for (const row of rows) {
      const isTotal =
        row.style === 'subtotal' ||
        row.style === 'highlight' ||
        row.style === 'result';
      const height = isTotal ? 22 : row.style === 'section' ? 19 : 16;

      if (y + height > BOTTOM) {
        doc.addPage();
        y = this.tableHeader(doc, PAGE.margin);
      }

      if (isTotal) {
        const fill =
          row.style === 'result'
            ? COLOR.resultFill
            : row.style === 'highlight'
              ? COLOR.highlightFill
              : COLOR.subtotalFill;
        doc.rect(PAGE.margin, y, CONTENT_WIDTH, height).fill(fill);
      }

      const onDark = row.style === 'result';
      const textY = y + (height - (isTotal ? 10 : 9)) / 2;
      const labelX = row.style === 'detail' ? COL.detail : COL.label;
      const font = row.style === 'detail' ? 'Helvetica' : 'Helvetica-Bold';
      const size = isTotal ? 10 : row.style === 'section' ? 9.5 : 9;
      const baseColor = onDark
        ? '#ffffff'
        : row.style === 'detail'
          ? COLOR.muted
          : COLOR.ink;
      const amountColor = row.negative && !onDark ? COLOR.negative : baseColor;

      doc
        .font(font)
        .fontSize(size)
        .fillColor(baseColor)
        .text(row.label, labelX, textY, {
          width: COL.amountRight - 120 - labelX,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .fillColor(amountColor)
        .text(row.amount, COL.amountRight - 110, textY, {
          width: 110,
          align: 'right',
          lineBreak: false,
        });
      doc
        .font('Helvetica')
        .fillColor(onDark ? '#ffffff' : COLOR.muted)
        .text(row.percent, COL.percentRight - 70, textY, {
          width: 70,
          align: 'right',
          lineBreak: false,
        });

      if (row.style === 'section' || row.style === 'detail') {
        doc
          .moveTo(PAGE.margin, y + height)
          .lineTo(PAGE.margin + CONTENT_WIDTH, y + height)
          .lineWidth(0.4)
          .strokeColor('#eceef1')
          .stroke();
      }
      y += height;
    }
    return y;
  }

  private sectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
    subtitle: string | null,
    top: number,
    needed: number,
  ): number {
    let y = top;
    if (y + needed > BOTTOM) {
      doc.addPage();
      y = PAGE.margin;
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(COLOR.ink)
      .text(title, PAGE.margin, y);
    if (subtitle) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLOR.muted)
        .text(subtitle, PAGE.margin, doc.y + 2, { width: CONTENT_WIDTH });
    }
    return doc.y + 6;
  }

  private cashBlock(
    doc: PDFKit.PDFDocument,
    rows: { label: string; amount: string }[],
    top: number,
  ): number {
    let y = this.sectionTitle(
      doc,
      'Movimientos de efectivo que no son gasto',
      'Dinero que salió o entró en el periodo sin afectar la utilidad.',
      top,
      60,
    );
    if (rows.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(COLOR.muted)
        .text('Sin movimientos de este tipo en el periodo.', PAGE.margin, y);
      return doc.y;
    }
    for (const row of rows) {
      if (y + 16 > BOTTOM) {
        doc.addPage();
        y = PAGE.margin;
      }
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLOR.ink)
        .text(row.label, COL.label, y + 3, { lineBreak: false })
        .text(row.amount, COL.amountRight - 110, y + 3, {
          width: 110,
          align: 'right',
          lineBreak: false,
        });
      doc
        .moveTo(PAGE.margin, y + 16)
        .lineTo(PAGE.margin + CONTENT_WIDTH, y + 16)
        .lineWidth(0.4)
        .strokeColor('#eceef1')
        .stroke();
      y += 16;
    }
    return y;
  }

  private notesBlock(
    doc: PDFKit.PDFDocument,
    notes: string[],
    top: number,
  ): number {
    if (notes.length === 0) return top - 20;
    let y = this.sectionTitle(doc, 'Avisos', null, top, 50);
    for (const note of notes) {
      const height = doc
        .font('Helvetica')
        .fontSize(8.5)
        .heightOfString(note, { width: CONTENT_WIDTH - 24 });
      if (y + height + 12 > BOTTOM) {
        doc.addPage();
        y = PAGE.margin;
      }
      doc.rect(PAGE.margin, y, 3, height + 8).fill('#e5a50a');
      doc
        .fillColor(COLOR.ink)
        .text(note, PAGE.margin + 12, y + 4, { width: CONTENT_WIDTH - 24 });
      y += height + 14;
    }
    return y;
  }

  private glossary(doc: PDFKit.PDFDocument, top: number): void {
    let y = this.sectionTitle(doc, 'Cómo leer este reporte', null, top, 110);
    for (const [term, meaning] of GLOSSARY) {
      const height = doc
        .font('Helvetica')
        .fontSize(8.5)
        .heightOfString(`${term}: ${meaning}`, { width: CONTENT_WIDTH });
      if (y + height > BOTTOM) {
        doc.addPage();
        y = PAGE.margin;
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(COLOR.ink)
        .text(`${term}: `, PAGE.margin, y, {
          width: CONTENT_WIDTH,
          continued: true,
        })
        .font('Helvetica')
        .fillColor(COLOR.muted)
        .text(meaning);
      y = doc.y + 4;
    }
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(
        'Base de efectivo: cada gasto cuenta en el mes en que se pagó. Los montos entre paréntesis ' +
          'restan. El IVA no es gasto: se cobra al cliente y se entera al SAT.',
        PAGE.margin,
        y + 6,
        { width: CONTENT_WIDTH },
      );
  }

  private footers(
    doc: PDFKit.PDFDocument,
    statement: IncomeStatementEntity,
  ): void {
    const range = doc.bufferedPageRange();
    const period = formatPeriod(
      statement.period.start_date,
      statement.period.end_date,
    ).toLowerCase();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const y = PAGE.height - PAGE.margin + 10;
      /* Sin margen inferior mientras se escribe el pie, o pdfkit abre otra página. */
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .moveTo(PAGE.margin, y - 6)
        .lineTo(PAGE.margin + CONTENT_WIDTH, y - 6)
        .lineWidth(0.5)
        .strokeColor(COLOR.rule)
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLOR.muted)
        .text(`Paldex · Estado de resultados ${period}`, PAGE.margin, y, {
          lineBreak: false,
        })
        .text(`Página ${i + 1} de ${range.count}`, PAGE.margin, y, {
          width: CONTENT_WIDTH,
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = bottomMargin;
    }
  }
}
