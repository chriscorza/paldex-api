import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { parseSalesDays } from '../employees/entities/employee.entity';
import { percentage, toMoneyNumber } from '../common/money';
import {
  currentMonthInZone,
  monthRangeInZone,
  reportsTimeZone,
  weekdayInZone,
  startOfDayInZone,
  endOfDayInZone,
  dateKeyInZone,
} from '../common/timezone';
import { SalesByEmployeeQueryDto } from './dto/sales-by-employee-query.dto';
import {
  SalesByEmployeePeriodEntity,
  SalesByEmployeeReportEntity,
  SalesByEmployeeRowEntity,
  SalesByEmployeeTotalsEntity,
  UNASSIGNED_ROW_NAME,
} from './entities/sales-by-employee.entity';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

interface Bucket {
  employee_id: number | null;
  employee_name: string;
  active: boolean;
  sales_days: number[];
  net_sales: Decimal;
  gross_sales: Decimal;
  sales_count: number;
  cogs: Decimal;
  sales_with_cost: number;
}

/*
 * Cuánto vendió cada quien, sabiendo sólo qué día fue la venta.
 *
 * `Income` no guarda quién atendió, y no hace falta: los turnos no se solapan
 * —una persona de lunes a viernes, otra el fin de semana—, así que el día de la
 * semana ya identifica al empleado. La asignación vive en `Employee.sales_days`.
 *
 * Consecuencia asumida: no hay historial de turnos. Un mes pasado se recalcula
 * con la asignación de hoy, así que si dos empleados intercambian días, los
 * reportes anteriores cambian con ellos.
 *
 * Además de las ventas se reporta el costo y la utilidad bruta de cada turno.
 * Es utilidad *de producto*: ventas netas menos costo de lo vendido, sin
 * descontar el sueldo de esa persona ni el gasto de la tienda. No mide lo que
 * el negocio gana con cada empleado, y leerla así lleva a conclusiones falsas.
 */
@Injectable()
export class SalesByEmployeeService {
  constructor(private prisma: PrismaService) {}

  async getSalesByEmployee(
    ctx: OwnershipContext,
    query: SalesByEmployeeQueryDto,
  ): Promise<SalesByEmployeeReportEntity> {
    const { year, month, startDate, endDate } = this.resolvePeriod(query);
    const timeZone = reportsTimeZone();
    const ownerFilter = buildOwnerFilter(ctx);

    const [employees, incomes] = await Promise.all([
      /*
       * Se traen también los inactivos. No reciben días —eso sigue siendo sólo
       * de los activos— pero hay que poder devolver el renglón de uno que se
       * pidió por id y marcarlo `active: false`, en vez de que desaparezca y su
       * cero se confunda con «no vendió nada».
       */
      this.prisma.employee.findMany({
        where: ownerFilter,
        select: { id: true, name: true, sales_days: true, active: true },
        orderBy: { name: 'asc' },
      }),
      /*
       * Se agrupa en Node y no en SQL: hacerlo con `CONVERT_TZ` obliga a que la
       * base de datos tenga cargadas las tablas de zonas horarias, y sin ellas
       * MySQL devuelve NULL —un reporte en ceros según cómo se aprovisionó el
       * contenedor—. `Intl` no depende de nada del servidor.
       *
       * No se filtra por `income_type` a propósito: el reporte mensual tampoco
       * lo hace, y filtrar aquí rompería el cuadre contra él.
       */
      this.prisma.income.findMany({
        where: { ...ownerFilter, date: { gte: startDate, lte: endDate } },
        select: {
          id: true,
          date: true,
          net_amount: true,
          gross_amount: true,
          /*
           * El costo sale exclusivamente de `CostOfGoodsSold` ligado a la venta
           * —nunca de un gasto de categoría COGS, que es compra de inventario y
           * tiene su propia línea—. Se traen las filas y se suman aquí en vez de
           * agregar aparte porque hay que repartirlas por día de la semana, y
           * eso ya se está haciendo sobre el ingreso.
           */
          cogs: { select: { total_cost: true } },
        },
      }),
    ]);

    this.validateEmployeeIds(query.employee_ids, employees);

    const buckets = new Map<number | null, Bucket>();
    const byDay = new Map<number, number>();
    const requested = query.employee_ids
      ? new Set(query.employee_ids)
      : undefined;

    for (const employee of employees) {
      /*
       * Un inactivo no tiene días —`sales_days` se le vacía al desactivarlo— y
       * un activo sin días asignados tampoco aporta renglón, salvo que lo hayan
       * pedido explícitamente: ahí sí se devuelve, en ceros y con su bandera,
       * porque «pedí a esta persona y no aparece» es peor que un cero explicado.
       */
      const days = employee.active ? parseSalesDays(employee.sales_days) : [];
      if (days.length === 0 && !requested?.has(employee.id)) continue;

      buckets.set(
        employee.id,
        this.emptyBucket(employee.id, employee.name, days, employee.active),
      );
      for (const day of days) byDay.set(day, employee.id);
    }

    /*
     * `unassigned` siempre se calcula, aunque valga cero: es lo que hace
     * comprobable el reporte. Sin él, las ventas de un día sin dueño
     * desaparecerían del total sin dejar rastro en vez de quedar a la vista.
     * Si se filtró y no lo pidieron, se quita al proyectar —no aquí—, para que
     * `period_totals` lo siga contando.
     */
    buckets.set(null, this.emptyBucket(null, UNASSIGNED_ROW_NAME, [], true));

    for (const income of incomes) {
      const weekday = weekdayInZone(income.date, timeZone);
      const employeeId = byDay.get(weekday) ?? null;
      const bucket = buckets.get(employeeId)!;

      /*
       * Los ingresos manuales antiguos pueden no traer `net_amount` ni
       * `gross_amount`. Se suman como cero —igual que `getMonthlyAggregates`—
       * para no divergir del reporte mensual, pero sí cuentan como venta.
       */
      bucket.net_sales = bucket.net_sales.add(income.net_amount ?? 0);
      bucket.gross_sales = bucket.gross_sales.add(income.gross_amount ?? 0);
      bucket.sales_count += 1;

      /*
       * Una venta sin costo capturado no resta nada, así que su utilidad sale
       * completa —inflada—. No se descarta, porque entonces el total dejaría de
       * cuadrar con las ventas; se cuenta aparte y se publica la cobertura para
       * que quien lea el reporte sepa de cuánto puede fiarse.
       */
      for (const linea of income.cogs) {
        bucket.cogs = bucket.cogs.add(linea.total_cost);
      }
      if (income.cogs.length > 0) bucket.sales_with_cost += 1;
    }

    const allBuckets = [...buckets.values()];

    /*
     * El filtro se aplica *después* de repartir las ventas, nunca acotando el
     * query de ingresos: para saber qué cae en `unassigned` hay que atribuir
     * contra todos los empleados. Filtrando antes, los días de los no
     * seleccionados se irían a `unassigned` y la cifra de la persona que se pidió
     * cambiaría según a quién más se hubiera pedido.
     */
    const visible = requested
      ? allBuckets.filter((row) =>
          row.employee_id === null
            ? query.include_unassigned === true
            : requested.has(row.employee_id),
        )
      : allBuckets;

    return new SalesByEmployeeReportEntity({
      period: new SalesByEmployeePeriodEntity({
        year,
        month,
        start_date: startDate,
        end_date: endDate,
      }),
      rows: visible.map((row) => this.projectRow(row)),
      totals: this.projectTotals(visible),
      period_totals: this.projectTotals(allBuckets),
    });
  }

  private projectRow(row: Bucket): SalesByEmployeeRowEntity {
    return new SalesByEmployeeRowEntity({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      active: row.active,
      sales_days: row.sales_days,
      net_sales: toMoneyNumber(row.net_sales) ?? 0,
      gross_sales: toMoneyNumber(row.gross_sales) ?? 0,
      sales_count: row.sales_count,
      cogs: toMoneyNumber(row.cogs) ?? 0,
      gross_profit: toMoneyNumber(row.net_sales.minus(row.cogs)) ?? 0,
      sales_with_cost: row.sales_with_cost,
      cost_data_coverage: percentage(row.sales_with_cost, row.sales_count),
    });
  }

  private projectTotals(rows: Bucket[]): SalesByEmployeeTotalsEntity {
    const totals = rows.reduce(
      (acc, row) => ({
        net_sales: acc.net_sales.add(row.net_sales),
        gross_sales: acc.gross_sales.add(row.gross_sales),
        sales_count: acc.sales_count + row.sales_count,
        cogs: acc.cogs.add(row.cogs),
        sales_with_cost: acc.sales_with_cost + row.sales_with_cost,
      }),
      {
        net_sales: new Decimal(0),
        gross_sales: new Decimal(0),
        sales_count: 0,
        cogs: new Decimal(0),
        sales_with_cost: 0,
      },
    );

    return new SalesByEmployeeTotalsEntity({
      net_sales: toMoneyNumber(totals.net_sales) ?? 0,
      gross_sales: toMoneyNumber(totals.gross_sales) ?? 0,
      sales_count: totals.sales_count,
      cogs: toMoneyNumber(totals.cogs) ?? 0,
      gross_profit: toMoneyNumber(totals.net_sales.minus(totals.cogs)) ?? 0,
      sales_with_cost: totals.sales_with_cost,
      cost_data_coverage: percentage(
        totals.sales_with_cost,
        totals.sales_count,
      ),
    });
  }

  /*
   * Un id que no sea de un empleado propio es un typo o un id viejo, no un dato
   * del negocio: devolverlo en ceros lo haría pasar por «esa persona no vendió».
   */
  private validateEmployeeIds(
    ids: number[] | undefined,
    employees: { id: number }[],
  ): void {
    if (!ids || ids.length === 0) return;

    const known = new Set(employees.map((e) => e.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown employee_ids: ${unknown.join(', ')}`,
      );
    }
  }

  private emptyBucket(
    id: number | null,
    name: string,
    days: number[],
    active: boolean,
  ): Bucket {
    return {
      employee_id: id,
      employee_name: name,
      active,
      sales_days: days,
      net_sales: new Decimal(0),
      gross_sales: new Decimal(0),
      sales_count: 0,
      cogs: new Decimal(0),
      sales_with_cost: 0,
    };
  }

  /*
   * `year`+`month` o `start_date`+`end_date`, nunca los dos —el mismo trato que
   * en `GET /reports/monthly`—. Sin nada, el mes en curso *de la tienda*: con la
   * zona del servidor —UTC en el contenedor— el día 1 antes de las 06:00 el
   * reporte ya habría saltado al mes siguiente mientras el negocio sigue
   * cerrando el anterior.
   */
  private resolvePeriod(query: SalesByEmployeeQueryDto): {
    year: number | null;
    month: number | null;
    startDate: Date;
    endDate: Date;
  } {
    const hasYear = query.year !== undefined;
    const hasMonth = query.month !== undefined;
    const hasStart = query.start_date !== undefined;
    const hasEnd = query.end_date !== undefined;

    if ((hasYear || hasMonth) && (hasStart || hasEnd)) {
      throw new BadRequestException(
        'Use either year+month or start_date+end_date, not both',
      );
    }
    if (hasYear !== hasMonth) {
      throw new BadRequestException(
        'Provide both year and month, or neither for the current month',
      );
    }
    if (hasStart !== hasEnd) {
      throw new BadRequestException(
        'Provide both start_date and end_date, or neither',
      );
    }

    if (hasStart) {
      const startDate = startOfDayInZone(query.start_date!);
      const endDate = endOfDayInZone(query.end_date!);
      if (endDate < startDate) {
        throw new BadRequestException('end_date must not precede start_date');
      }
      return { ...this.declaredMonth(startDate, endDate), startDate, endDate };
    }

    const { year, month } = hasYear
      ? { year: query.year!, month: query.month! }
      : currentMonthInZone();

    return { year, month, ...monthRangeInZone(year, month) };
  }

  /*
   * Un rango sólo declara mes si lo cubre exactamente. Deducirlo de
   * `start_date` haría que un 15-ene a 15-feb se anunciara como enero: una
   * respuesta equivocada dicha con seguridad, que es peor que no decir nada.
   */
  private declaredMonth(
    startDate: Date,
    endDate: Date,
  ): { year: number | null; month: number | null } {
    const timeZone = reportsTimeZone();
    const [year, month] = dateKeyInZone(startDate, timeZone)
      .split('-')
      .map(Number);
    const candidate = monthRangeInZone(year, month, timeZone);

    const exact =
      candidate.startDate.getTime() === startDate.getTime() &&
      candidate.endDate.getTime() === endDate.getTime();

    return exact ? { year, month } : { year: null, month: null };
  }
}
