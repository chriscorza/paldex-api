import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  OwnershipContext,
  buildOwnerFilter,
  effectiveOwnerId,
} from '../common/ownership';
import {
  dateKeyInZone,
  eachDateKeyInZone,
  endOfDayInZone,
  reportsTimeZone,
  startOfDayInZone,
} from '../common/timezone';
import { percentage } from '../common/money';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ProfitEngine } from './profit-engine.service';
import {
  depreciationInRange,
  disposalResult,
} from '../fixed-assets/depreciation';
import { IncomeStatementQueryDto } from './dto/income-statement-query.dto';
import {
  IncomeStatementEntity,
  IncomeStatementLineEntity,
  IncomeStatementWarningEntity,
} from './entities/income-statement.entity';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const MAX_RANGE_DAYS = 366;

type ExpenseBucket =
  | 'cost_of_sales'
  | 'operating'
  | 'interest'
  | 'asset_purchases'
  | 'inventory_purchases'
  | 'debt_principal_paid'
  | 'owner_withdrawals'
  | 'reinvestment'
  | 'other_non_operating';

export interface CategoryInfo {
  id: number;
  name: string;
  type: string;
  affects_gross_profit: boolean;
  affects_operating_profit: boolean;
}

/*
 * En qué renglón cae un gasto pagado, según su categoría. Cada gasto cae en
 * exactamente uno, del P&L o del bloque de flujo: la prueba de cuadre lo exige.
 *
 * - COGS es compra de inventario: flujo. El costo de lo vendido sale de
 *   CostOfGoodsSold (regla de no duplicación 3).
 * - SHOPIFY_FEES / SHIPPING, o cualquier otra que afecte la utilidad bruta, son
 *   costo de ventas. El reporte mensual las perdía: no restaba nada contra la
 *   utilidad bruta.
 * - INTEREST va abajo del EBIT. Una DEBT que marca `affects_operating_profit`
 *   es como se modelaban los intereses antes de INTEREST: también es interés.
 * - CAPEX es compra de activo: flujo; al P&L entra su depreciación.
 * - OWNER se parte por nombre, como en el reporte mensual: es el único indicio.
 * - Sin categoría reconocible cuenta como operativo: es lo que menos miente.
 */
export function classifyExpense(category?: CategoryInfo): ExpenseBucket {
  if (!category) return 'operating';
  switch (category.type) {
    case 'COGS':
      return 'inventory_purchases';
    case 'SHOPIFY_FEES':
    case 'SHIPPING':
      return 'cost_of_sales';
    case 'INTEREST':
      return 'interest';
    case 'CAPEX':
      return 'asset_purchases';
    case 'OWNER':
      return category.name === 'Reinversión'
        ? 'reinvestment'
        : 'owner_withdrawals';
    case 'DEBT':
      return category.affects_operating_profit
        ? 'interest'
        : 'debt_principal_paid';
  }
  if (category.affects_gross_profit) return 'cost_of_sales';
  if (category.affects_operating_profit) return 'operating';
  return 'other_non_operating';
}

const zero = () => new Decimal(0);
const num = (d: Decimal) => d.toDecimalPlaces(2).toNumber();

@Injectable()
export class IncomeStatementService {
  private readonly engine = new ProfitEngine();

  constructor(
    private prisma: PrismaService,
    private aggregation: ReportsAggregationService,
  ) {}

  async getIncomeStatement(
    ctx: OwnershipContext,
    query: IncomeStatementQueryDto,
  ): Promise<IncomeStatementEntity> {
    const timeZone = reportsTimeZone();
    const startDate = startOfDayInZone(query.start_date, timeZone);
    const endDate = endOfDayInZone(query.end_date, timeZone);

    if (endDate < startDate) {
      throw new BadRequestException('end_date must not precede start_date');
    }
    const days = eachDateKeyInZone(startDate, endDate, timeZone).length;
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Range must not exceed ${MAX_RANGE_DAYS} days (requested ${days})`,
      );
    }

    const ownerFilter = buildOwnerFilter(ctx);

    /*
     * Ventas netas, COGS, nómina neta y cobertura de costo salen de las mismas
     * consultas que GET /reports/monthly: así cuadran con él por construcción,
     * no por coincidencia.
     */
    const [aggregates, paidByCategory, categories, taxesByType, assets] =
      await Promise.all([
        this.aggregation.getMonthlyAggregates(ctx, startDate, endDate),
        this.prisma.expense.groupBy({
          by: ['category_id'],
          where: {
            ...ownerFilter,
            status: 'PAID',
            paid_at: { gte: startDate, lte: endDate },
          },
          _sum: { amount: true },
        }),
        this.prisma.expenseCategory.findMany({
          select: {
            id: true,
            name: true,
            type: true,
            affects_gross_profit: true,
            affects_operating_profit: true,
          },
        }),
        this.prisma.taxPayment.groupBy({
          by: ['type'],
          where: {
            ...ownerFilter,
            status: 'PAID',
            paid_at: { gte: startDate, lte: endDate },
          },
          _sum: { amount: true },
        }),
        this.prisma.fixedAsset.findMany({ where: { ...ownerFilter } }),
      ]);

    const quality = this.engine.calculate(aggregates).quality;
    const byId = new Map<number, CategoryInfo>(
      categories.map((c) => [c.id, c as CategoryInfo]),
    );

    /* ---- Gastos por renglón, con su desglose por categoría ---- */
    const buckets: Record<ExpenseBucket, Decimal> = {
      cost_of_sales: zero(),
      operating: zero(),
      interest: zero(),
      asset_purchases: zero(),
      inventory_purchases: zero(),
      debt_principal_paid: zero(),
      owner_withdrawals: zero(),
      reinvestment: zero(),
      other_non_operating: zero(),
    };
    const detail: Partial<Record<ExpenseBucket, IncomeStatementLineEntity[]>> =
      {};

    for (const row of paidByCategory) {
      const amount = new Decimal(row._sum.amount ?? 0);
      if (amount.isZero()) continue;
      const category = row.category_id ? byId.get(row.category_id) : undefined;
      const bucket = classifyExpense(category);
      buckets[bucket] = buckets[bucket].plus(amount);
      (detail[bucket] ??= []).push({
        key: category ? `category:${category.id}` : 'category:none',
        label: category?.name ?? 'Sin categoría',
        amount: num(amount),
        kind: 'line',
        level: 1,
      });
    }

    /* ---- Impuestos según su tipo ---- */
    const tax = (type: string) =>
      new Decimal(taxesByType.find((t) => t.type === type)?._sum.amount ?? 0);
    const vatPaid = tax('IVA');
    const payrollTaxes = tax('PAYROLL_TAX');
    const incomeTax = tax('ISR');
    const otherTaxes = tax('OTHER');

    /* ---- Activos: depreciación, amortización y bajas ---- */
    let depreciation = zero();
    let amortization = zero();
    let disposalResults = zero();
    let assetSales = zero();
    const warnings: IncomeStatementWarningEntity[] = [];
    const fromKey = dateKeyInZone(startDate, timeZone);
    const toKey = dateKeyInZone(endDate, timeZone);

    for (const asset of assets) {
      const amount = depreciationInRange(asset, startDate, endDate, timeZone);
      if (asset.kind === 'INTANGIBLE') amortization = amortization.plus(amount);
      else depreciation = depreciation.plus(amount);

      if (
        asset.disposed_at &&
        asset.disposed_at >= startDate &&
        asset.disposed_at <= endDate
      ) {
        disposalResults = disposalResults.plus(
          disposalResult(asset, timeZone) ?? 0,
        );
        assetSales = assetSales.plus(asset.disposal_amount ?? 0);
      }

      const acquiredKey = dateKeyInZone(asset.acquired_at, timeZone);
      if (!asset.expense_id && acquiredKey >= fromKey && acquiredKey <= toKey) {
        warnings.push({
          code: 'ASSET_WITHOUT_PURCHASE_EXPENSE',
          asset_id: asset.id,
          message:
            `El activo "${asset.name}" se compró en este periodo y no tiene gasto vinculado. ` +
            'Si su compra quedó capturada en otra categoría que no sea "Compra de activo fijo", ' +
            'se está contando como gasto y como depreciación.',
        });
      }
    }

    /* ---- Cascada ---- */
    const netSales = new Decimal(aggregates.net_sales);
    const cogs = new Decimal(aggregates.cogs ?? 0);
    const payrollNet = new Decimal(aggregates.payroll_paid);

    const costOfSales = cogs.plus(buckets.cost_of_sales);
    const grossProfit = netSales.minus(costOfSales);
    const operating = buckets.operating.plus(otherTaxes);
    const payroll = payrollNet.plus(payrollTaxes);
    const ebitda = grossProfit.minus(operating).minus(payroll);
    const da = depreciation.plus(amortization);
    const ebit = ebitda.minus(da);
    const interest = buckets.interest;
    const preTax = ebit.minus(interest).plus(disposalResults);
    const netIncome = preTax.minus(incomeTax);

    const margin = (d: Decimal) => percentage(d, netSales);
    const sortDesc = (rows: IncomeStatementLineEntity[] = []) =>
      rows.sort((a, b) => b.amount - a.amount);

    const operatingChildren = sortDesc(detail.operating);
    if (!otherTaxes.isZero()) {
      operatingChildren.push({
        key: 'tax:OTHER',
        label: 'Otros impuestos y derechos',
        amount: num(otherTaxes),
        kind: 'line',
        level: 1,
      });
    }

    const line = (
      key: string,
      label: string,
      amount: Decimal,
      children?: IncomeStatementLineEntity[],
    ): IncomeStatementLineEntity => ({
      key,
      label,
      amount: num(amount),
      kind: 'line',
      level: 0,
      ...(children && children.length ? { children } : {}),
    });
    const subtotal = (
      key: string,
      label: string,
      amount: Decimal,
    ): IncomeStatementLineEntity => ({
      key,
      label,
      amount: num(amount),
      kind: 'subtotal',
      level: 0,
      margin: margin(amount),
    });
    const child = (key: string, label: string, amount: Decimal) => ({
      key,
      label,
      amount: num(amount),
      kind: 'line' as const,
      level: 1,
    });

    const lines: IncomeStatementLineEntity[] = [
      subtotal('net_sales', 'Ventas netas', netSales),
      line('cost_of_sales', 'Costo de ventas', costOfSales, [
        child('cogs', 'Costo de lo vendido', cogs),
        ...sortDesc(detail.cost_of_sales),
      ]),
      subtotal('gross_profit', 'Utilidad bruta', grossProfit),
      line(
        'operating_expenses',
        'Gastos de operación',
        operating,
        operatingChildren,
      ),
      line('payroll', 'Nómina', payroll, [
        child('payroll_net', 'Sueldos pagados (neto)', payrollNet),
        child('payroll_taxes', 'Cuotas e impuestos de nómina', payrollTaxes),
      ]),
      subtotal('ebitda', 'EBITDA', ebitda),
      line('depreciation_amortization', 'Depreciación y amortización', da, [
        child('depreciation', 'Depreciación', depreciation),
        child('amortization', 'Amortización', amortization),
      ]),
      subtotal('ebit', 'Utilidad operativa (EBIT)', ebit),
      line('interest', 'Intereses', interest, sortDesc(detail.interest)),
      line(
        'other_results',
        'Ganancia/pérdida en baja de activos',
        disposalResults,
      ),
      subtotal('pre_tax_income', 'Utilidad antes de impuestos', preTax),
      line('income_tax', 'Impuestos a la utilidad (ISR)', incomeTax),
      subtotal('net_income', 'Utilidad neta', netIncome),
    ];

    return {
      period: { start_date: fromKey, end_date: toKey },
      basis: 'CASH',
      lines,
      summary: {
        net_sales: num(netSales),
        cost_of_sales: num(costOfSales),
        gross_profit: num(grossProfit),
        operating_expenses: num(operating),
        payroll: num(payroll),
        ebitda: num(ebitda),
        depreciation_amortization: num(da),
        ebit: num(ebit),
        interest: num(interest),
        other_results: num(disposalResults),
        pre_tax_income: num(preTax),
        income_tax: num(incomeTax),
        net_income: num(netIncome),
        gross_margin: margin(grossProfit),
        ebitda_margin: margin(ebitda),
        ebit_margin: margin(ebit),
        pre_tax_margin: margin(preTax),
        net_margin: margin(netIncome),
      },
      cash_items: {
        vat_paid: num(vatPaid),
        asset_purchases: num(buckets.asset_purchases),
        asset_sales: num(assetSales),
        inventory_purchases: num(buckets.inventory_purchases),
        debt_principal_paid: num(buckets.debt_principal_paid),
        owner_withdrawals: num(buckets.owner_withdrawals),
        reinvestment: num(buckets.reinvestment),
        other_non_operating: num(buckets.other_non_operating),
      },
      quality: {
        sales_without_cost: quality.sales_without_cost,
        cost_data_coverage: quality.cost_data_coverage,
        incomplete_cost_data: quality.incomplete_cost_data,
      },
      warnings,
    };
  }

  /*
   * El nombre que encabeza el PDF: el del dueño de los libros (no el de quien
   * llama: con una llave re-enlazada son distintos). Sin nombre, su correo.
   */
  async businessName(ctx: OwnershipContext): Promise<string> {
    const owner = await this.prisma.user.findUnique({
      where: { id: effectiveOwnerId(ctx) },
      select: { name: true, email: true },
    });
    return owner?.name?.trim() || owner?.email || 'Paldex';
  }

  /* Los mismos renglones que la pantalla, aplanados: el CSV no puede divergir. */
  toCsvRows(statement: IncomeStatementEntity): string[][] {
    const rows: string[][] = [['key', 'label', 'level', 'amount', 'margin']];
    const walk = (items: IncomeStatementLineEntity[]) => {
      for (const item of items) {
        rows.push([
          item.key,
          item.label,
          String(item.level),
          item.amount.toFixed(2),
          item.margin === undefined || item.margin === null
            ? ''
            : String(item.margin),
        ]);
        if (item.children) walk(item.children);
      }
    };
    walk(statement.lines);
    const c = statement.cash_items;
    rows.push(['', '', '', '', '']);
    const cash: [keyof typeof c, string][] = [
      ['vat_paid', 'IVA enterado'],
      ['asset_purchases', 'Compra de activos'],
      ['asset_sales', 'Venta de activos (entrada)'],
      ['inventory_purchases', 'Compras de inventario'],
      ['debt_principal_paid', 'Pago de capital de deuda'],
      ['owner_withdrawals', 'Retiros del dueño'],
      ['reinvestment', 'Reinversión'],
      ['other_non_operating', 'Otras salidas no operativas'],
    ];
    for (const [key, label] of cash) {
      rows.push([`cash:${key}`, label, '0', c[key].toFixed(2), '']);
    }
    return rows;
  }
}
