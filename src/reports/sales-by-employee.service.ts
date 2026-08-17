import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { parseSalesDays } from '../employees/entities/employee.entity';
import { toMoneyNumber } from '../common/money';
import {
  currentMonthInZone,
  monthRangeInZone,
  reportsTimeZone,
  weekdayInZone,
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
  sales_days: number[];
  net_sales: Decimal;
  gross_sales: Decimal;
  sales_count: number;
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
      this.prisma.employee.findMany({
        where: { ...ownerFilter, active: true },
        select: { id: true, name: true, sales_days: true },
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
        },
      }),
    ]);

    const buckets = new Map<number | null, Bucket>();
    const byDay = new Map<number, number>();

    for (const employee of employees) {
      const days = parseSalesDays(employee.sales_days);
      if (days.length === 0) continue;

      buckets.set(
        employee.id,
        this.emptyBucket(employee.id, employee.name, days),
      );
      for (const day of days) byDay.set(day, employee.id);
    }

    /*
     * `unassigned` siempre está, aunque valga cero: es lo que hace comprobable
     * el reporte. Sin él, las ventas de un día sin dueño desaparecerían del
     * total sin dejar rastro en vez de quedar a la vista.
     */
    buckets.set(null, this.emptyBucket(null, UNASSIGNED_ROW_NAME, []));

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
    }

    const rows = [...buckets.values()];
    const totals = rows.reduce(
      (acc, row) => ({
        net_sales: acc.net_sales.add(row.net_sales),
        gross_sales: acc.gross_sales.add(row.gross_sales),
        sales_count: acc.sales_count + row.sales_count,
      }),
      {
        net_sales: new Decimal(0),
        gross_sales: new Decimal(0),
        sales_count: 0,
      },
    );

    return new SalesByEmployeeReportEntity({
      period: new SalesByEmployeePeriodEntity({
        year,
        month,
        start_date: startDate,
        end_date: endDate,
      }),
      rows: rows.map(
        (row) =>
          new SalesByEmployeeRowEntity({
            employee_id: row.employee_id,
            employee_name: row.employee_name,
            sales_days: row.sales_days,
            net_sales: toMoneyNumber(row.net_sales) ?? 0,
            gross_sales: toMoneyNumber(row.gross_sales) ?? 0,
            sales_count: row.sales_count,
          }),
      ),
      totals: new SalesByEmployeeTotalsEntity({
        net_sales: toMoneyNumber(totals.net_sales) ?? 0,
        gross_sales: toMoneyNumber(totals.gross_sales) ?? 0,
        sales_count: totals.sales_count,
      }),
    });
  }

  private emptyBucket(id: number | null, name: string, days: number[]): Bucket {
    return {
      employee_id: id,
      employee_name: name,
      sales_days: days,
      net_sales: new Decimal(0),
      gross_sales: new Decimal(0),
      sales_count: 0,
    };
  }

  /*
   * Sin parámetros, el mes en curso *de la tienda*: con la zona del servidor
   * —UTC en el contenedor— el día 1 antes de las 06:00 el reporte ya habría
   * saltado al mes siguiente mientras el negocio sigue cerrando el anterior.
   */
  private resolvePeriod(query: SalesByEmployeeQueryDto) {
    const hasYear = query.year !== undefined;
    const hasMonth = query.month !== undefined;

    if (hasYear !== hasMonth) {
      throw new BadRequestException(
        'Provide both year and month, or neither for the current month',
      );
    }

    const { year, month } = hasYear
      ? { year: query.year!, month: query.month! }
      : currentMonthInZone();

    return { year, month, ...monthRangeInZone(year, month) };
  }
}
