import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import {
  reportsTimeZone,
  startOfDayInZone,
  endOfDayInZone,
  dateKeyInZone,
  eachDateKeyInZone,
} from '../common/timezone';
import { DailySalesQueryDto } from './dto/daily-sales-query.dto';
import {
  DailySalesReportEntity,
  DailySalesRowEntity,
  DailySalesTotalsEntity,
} from './entities/daily-sales.entity';

const Decimal = Prisma.Decimal;

/*
 * Un rango más largo que esto se rechaza en vez de recortarse. Recortar
 * devolvería una serie que parece completa y cuyos totales están mal en
 * silencio; 366 días cubren cualquier comparación contra el año pasado.
 */
const MAX_RANGE_DAYS = 366;

interface Bucket {
  net_sales: Prisma.Decimal;
  gross_sales: Prisma.Decimal;
  discounts: Prisma.Decimal;
  fees: Prisma.Decimal;
  shipping_charged: Prisma.Decimal;
  sales_count: number;
}

@Injectable()
export class DailySalesService {
  constructor(private prisma: PrismaService) {}

  async getDailySales(
    ctx: OwnershipContext,
    query: DailySalesQueryDto,
  ): Promise<DailySalesReportEntity> {
    const timeZone = reportsTimeZone();
    const startDate = startOfDayInZone(query.start_date, timeZone);
    const endDate = endOfDayInZone(query.end_date, timeZone);

    if (endDate < startDate) {
      throw new BadRequestException('end_date must not precede start_date');
    }

    const dayKeys = eachDateKeyInZone(startDate, endDate, timeZone);
    if (dayKeys.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Range must not exceed ${MAX_RANGE_DAYS} days (requested ${dayKeys.length})`,
      );
    }

    /*
     * No se filtra por `income_type` a propósito: `GET /reports/monthly` tampoco
     * lo hace, y filtrar aquí rompería el cuadre contra él —que es justo lo que
     * hace confiable a este reporte—. Los mismos campos, además, para que la
     * suma de los días dé el `net_sales` del mes.
     */
    const incomes = await this.prisma.income.findMany({
      where: {
        ...buildOwnerFilter(ctx),
        date: { gte: startDate, lte: endDate },
      },
      select: {
        date: true,
        net_amount: true,
        gross_amount: true,
        discount_total: true,
        fee_total: true,
        shipping_charged: true,
      },
    });

    /*
     * Todos los días del rango se siembran en cero antes de repartir las ventas:
     * un día sin ventas tiene que salir como cero y no faltar, porque «no vendió
     * nada» y «no hay dato» llevan a conclusiones opuestas.
     */
    const buckets = new Map<string, Bucket>();
    for (const key of dayKeys) {
      buckets.set(key, this.emptyBucket());
    }

    for (const income of incomes) {
      /*
       * El día se decide en la zona del negocio, nunca con el timestamp crudo.
       * Ver `dateKeyInZone`: agrupar en SQL manda toda la tarde-noche al día
       * siguiente, o devuelve NULL y deja el reporte en ceros.
       */
      const key = dateKeyInZone(income.date, timeZone);
      const bucket = buckets.get(key);

      /*
       * Defensivo: el filtro del query y el rango de días salen del mismo par de
       * instantes, así que no debería fallar. Si algún día lo hace, es preferible
       * ignorar la fila a inventarle un día fuera del rango pedido.
       */
      if (!bucket) continue;

      bucket.net_sales = bucket.net_sales.add(income.net_amount ?? 0);
      bucket.gross_sales = bucket.gross_sales.add(income.gross_amount ?? 0);
      bucket.discounts = bucket.discounts.add(income.discount_total ?? 0);
      bucket.fees = bucket.fees.add(income.fee_total ?? 0);
      bucket.shipping_charged = bucket.shipping_charged.add(
        income.shipping_charged ?? 0,
      );
      bucket.sales_count += 1;
    }

    const days = dayKeys.map(
      (key) => new DailySalesRowEntity({ date: key, ...buckets.get(key)! }),
    );

    return new DailySalesReportEntity({
      start_date: startDate,
      end_date: endDate,
      time_zone: timeZone,
      days,
      totals: this.totalsOf(days),
    });
  }

  private emptyBucket(): Bucket {
    return {
      net_sales: new Decimal(0),
      gross_sales: new Decimal(0),
      discounts: new Decimal(0),
      fees: new Decimal(0),
      shipping_charged: new Decimal(0),
      sales_count: 0,
    };
  }

  /*
   * Los totales se suman sobre los renglones ya proyectados y no sobre los
   * `Decimal` de los buckets, para que cuadren exactamente con lo que el
   * consumidor recibe en vez de con un redondeo intermedio distinto.
   */
  private totalsOf(days: DailySalesRowEntity[]): DailySalesTotalsEntity {
    const totals = days.reduce((acc, day) => {
      acc.net_sales = acc.net_sales.add(day.net_sales);
      acc.gross_sales = acc.gross_sales.add(day.gross_sales);
      acc.discounts = acc.discounts.add(day.discounts);
      acc.fees = acc.fees.add(day.fees);
      acc.shipping_charged = acc.shipping_charged.add(day.shipping_charged);
      acc.sales_count += day.sales_count;
      return acc;
    }, this.emptyBucket());

    return new DailySalesTotalsEntity({
      net_sales: totals.net_sales.toNumber(),
      gross_sales: totals.gross_sales.toNumber(),
      discounts: totals.discounts.toNumber(),
      fees: totals.fees.toNumber(),
      shipping_charged: totals.shipping_charged.toNumber(),
      sales_count: totals.sales_count,
      days: days.length,
      days_with_sales: days.filter((day) => day.sales_count > 0).length,
    });
  }
}
