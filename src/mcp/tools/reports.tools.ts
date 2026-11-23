import { z } from 'zod';
import { McpToolkit } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { DATE_RULE, rangeInput, rangeOf } from './shared';
import { OwnershipContext, effectiveOwnerId } from '../../common/ownership';
import { dateKeyInZone, reportsTimeZone } from '../../common/timezone';
import { DailySalesQueryDto } from '../../reports/dto/daily-sales-query.dto';
import { IncomeStatementQueryDto } from '../../reports/dto/income-statement-query.dto';
import { SalesByEmployeeQueryDto } from '../../reports/dto/sales-by-employee-query.dto';
import { InventoryValuationQueryDto } from '../../inventory/dto/inventory-valuation-query.dto';

const RANGE_RULE =
  'Las dos fechas son obligatorias: no hay periodo por omisión, así que resuelve qué quiso decir el usuario y pásalas explícitas.';

export function defineReportTools(k: McpToolkit, s: McpServices) {
  /* ---- Contexto ---- */
  k.define({
    name: 'context_get',
    title: 'Get working context',
    kind: 'read',
    permission: 'report:read',
    description:
      'Llámala al empezar y cada vez que te falte un id. Devuelve en una sola llamada: de quién son los libros, la fecha de hoy en la ' +
      'zona del negocio, cuentas, categorías de gasto (con tipo), impuestos del catálogo, empleados activos y los meses cerrados del ' +
      'último año. Una parte que tu rol no puede leer viene en null con el motivo, no vacía.',
    input: {},
    handler: async (ctx) => {
      const part = async <T>(
        permission: string,
        read: (c: OwnershipContext) => Promise<T>,
      ) => {
        const c = await k.contextFor(ctx, permission);
        return c
          ? await read(c)
          : { unavailable: true, reason: `Tu rol no tiene ${permission}` };
      };
      const owner = await s.prisma.user.findUnique({
        where: { id: effectiveOwnerId(ctx) },
        select: { id: true, name: true, email: true },
      });
      const now = new Date();
      const [accounts, categories, taxes, employees, closed] =
        await Promise.all([
          part('account:read', async (c) =>
            (await s.accounts.findAll(c, { limit: 100 } as any)).data.map(
              (a: any) => ({
                id: a.id,
                name: a.name,
                type: a.type,
                balance: a.balance,
              }),
            ),
          ),
          part('expense_category:read', async (c) =>
            (
              (await s.expenseCategories.findAll(c, {
                limit: 200,
              } as any)) as any
            ).data.map((x: any) => ({
              id: x.id,
              name: x.name,
              type: x.type,
              is_system: x.is_system,
            })),
          ),
          part('tax:read', async () =>
            (await s.taxes.findAll({ limit: 100 } as any)).data.map(
              (t: any) => ({
                id: t.id,
                name: t.name,
                rate: t.rate,
              }),
            ),
          ),
          part('employee:read', async (c) =>
            (
              (await s.employees.findAll(c, {
                active: true,
                limit: 100,
              } as any)) as any
            ).data.map((e: any) => ({
              id: e.id,
              name: e.name,
              pay_frequency: e.pay_frequency,
            })),
          ),
          part('monthly_close:read', async (c) => {
            const since = new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000);
            const rows = await s.prisma.monthlyClose.findMany({
              where: {
                user_id: effectiveOwnerId(c),
                status: 'CLOSED',
                OR: [
                  { year: { gt: since.getUTCFullYear() } },
                  {
                    year: since.getUTCFullYear(),
                    month: { gte: since.getUTCMonth() + 1 },
                  },
                ],
              },
              select: { year: true, month: true },
              orderBy: [{ year: 'desc' }, { month: 'desc' }],
            });
            return rows.map(
              (r) => `${r.year}-${String(r.month).padStart(2, '0')}`,
            );
          }),
        ]);
      return {
        books_owner: owner,
        today: dateKeyInZone(now),
        time_zone: reportsTimeZone(),
        accounts,
        expense_categories: categories,
        taxes,
        employees,
        closed_months: closed,
      };
    },
  });

  /* ---- Reportes ---- */
  k.define({
    name: 'sales_daily',
    title: 'Daily sales',
    kind: 'read',
    permission: 'report:read',
    description:
      'Ventas día por día en un rango (netas, brutas, descuentos, comisiones, envío, número de ventas) más totales. Los días sin ventas ' +
      'salen en cero. Días de la tienda, no UTC. Como GET /reports/sales-daily. Máximo 366 días. ' +
      RANGE_RULE,
    input: rangeInput,
    dto: DailySalesQueryDto,
    handler: (ctx, _args, dto) => s.dailySales.getDailySales(ctx, dto),
  });

  k.define({
    name: 'income_statement',
    title: 'Income statement (P&L) with EBITDA',
    kind: 'read',
    permission: 'report:read',
    description:
      'Estado de resultados en base de efectivo: ventas netas − costo de ventas = utilidad bruta; − gastos de operación − nómina = EBITDA; ' +
      '− depreciación = EBIT; − intereses ± bajas de activos = antes de impuestos; − ISR = utilidad neta. El IVA, las compras de activos e ' +
      'inventario, el pago de capital y los retiros vienen en cash_items. Revisa quality: con costo incompleto, la utilidad bruta es un techo. ' +
      'Como GET /reports/income-statement. Máximo 366 días. ' +
      RANGE_RULE,
    input: rangeInput,
    dto: IncomeStatementQueryDto,
    handler: (ctx, _args, dto) =>
      s.incomeStatement.getIncomeStatement(ctx, dto),
  });

  k.define({
    name: 'sales_by_employee',
    title: 'Sales by employee',
    kind: 'read',
    permission: 'report:read',
    description:
      'Ventas atribuidas a cada empleado por día de la semana (sales_days), con costo, utilidad bruta y cobertura de costo. totals cubre ' +
      'los renglones devueltos y period_totals el periodo completo. No hay historial de turnos: el rango se calcula con la asignación de ' +
      'hoy. Como GET /reports/sales-by-employee. ' +
      RANGE_RULE,
    input: {
      ...rangeInput,
      employee_ids: z
        .array(z.number().int())
        .optional()
        .describe(
          'Omítelo para todos. Un id para una persona, varios para compararlas.',
        ),
      include_unassigned: z
        .boolean()
        .optional()
        .describe(
          'Incluir el renglón de ventas en días sin dueño al filtrar por empleado.',
        ),
    },
    handler: (ctx, args) =>
      s.salesByEmployee.getSalesByEmployee(
        ctx,
        args as SalesByEmployeeQueryDto,
      ),
  });

  k.define({
    name: 'monthly_report',
    title: 'Monthly profit report',
    kind: 'read',
    permission: 'report:read',
    description:
      'El reporte de utilidad de la pantalla mensual (GET /reports/monthly) para un rango: ventas, costo, utilidad bruta, operativa y neta, ' +
      'pendientes y calidad de datos. Para EBITDA usa income_statement. ' +
      RANGE_RULE,
    input: rangeInput,
    handler: async (ctx, args) => {
      const { startDate, endDate } = rangeOf(args as any);
      return s.profitEngine.calculate(
        await s.aggregation.getMonthlyAggregates(ctx, startDate, endDate),
      );
    },
  });

  k.define({
    name: 'expenses_breakdown',
    title: 'Expenses breakdown',
    kind: 'read',
    permission: 'report:read',
    description:
      'Gastos pagados por categoría en un rango, comparados contra el mismo rango un mes antes (GET /reports/monthly/expenses-breakdown). ' +
      RANGE_RULE,
    input: rangeInput,
    handler: (ctx, args) => {
      const { startDate, endDate } = rangeOf(args as any);
      const prevStart = new Date(startDate);
      prevStart.setMonth(prevStart.getMonth() - 1);
      const prevEnd = new Date(endDate);
      prevEnd.setMonth(prevEnd.getMonth() - 1);
      return s.aggregation.getExpensesBreakdown(
        ctx,
        startDate,
        endDate,
        prevStart,
        prevEnd,
      );
    },
  });

  k.define({
    name: 'cash_report',
    title: 'Cash position',
    kind: 'read',
    permission: 'report:read',
    description:
      'Saldo de cada cuenta y lo pendiente por pagar (GET /reports/cash). Foto de hoy, sin rango.',
    input: {},
    handler: (ctx) => s.aggregation.getCashReport(ctx),
  });

  k.define({
    name: 'sales_without_cost',
    title: 'Sales without cost',
    kind: 'read',
    permission: 'report:read',
    description:
      'Ventas de un rango sin costo de lo vendido capturado (GET /reports/sales-without-cost): son las que vuelven techo a la utilidad bruta. ' +
      RANGE_RULE,
    input: rangeInput,
    handler: (ctx, args) => {
      const { startDate, endDate } = rangeOf(args as any);
      return s.aggregation.getSalesWithoutCost(ctx, startDate, endDate);
    },
  });

  k.define({
    name: 'inventory_valuation',
    title: 'Inventory valuation',
    kind: 'read',
    permission: 'report:read',
    description:
      'Cuánto vale el inventario en existencia, al costo y a precio de lista, desde la última foto diaria (GET /reports/inventory-valuation).',
    input: dtoToZodShape(InventoryValuationQueryDto),
    dto: InventoryValuationQueryDto,
    handler: (ctx, _args, dto) => s.inventoryValuation.getValuation(ctx, dto),
  });

  k.define({
    name: 'monthly_close_status',
    title: 'Monthly close status',
    kind: 'read',
    permission: 'monthly_close:read',
    description:
      'Estado del cierre de un mes y su revisión previa (pendientes, ventas sin costo, avisos). Sólo lee: cerrar o reabrir un mes lo ' +
      'hace el dueño desde la app. ' +
      DATE_RULE,
    input: {
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    },
    handler: async (ctx, args) => ({
      close: await s.monthlyClose.findOne(ctx, args.year, args.month),
      preflight: await s.monthlyClose.preflight(ctx, args.year, args.month),
    }),
  });
}
