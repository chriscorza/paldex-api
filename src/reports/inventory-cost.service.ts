import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { divideMoney, percentage, toMoneyNumber } from '../common/money';
import {
  currentMonthInZone,
  endOfDayInZone,
  monthRangeInZone,
  startOfDayInZone,
} from '../common/timezone';
import { InventoryCostQueryDto } from './dto/inventory-cost-query.dto';
import {
  InventoryCostPeriodEntity,
  InventoryCostProductEntity,
  InventoryCostReportEntity,
  InventoryCostTotalsEntity,
} from './entities/inventory-cost.entity';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/* Artículo sin variante, sin SKU y sin nombre: todos caen en un solo renglón. */
const UNIDENTIFIED_KEY = 'unidentified';

interface Bucket {
  shopify_variant_id: string | null;
  sku: string | null;
  title: string | null;
  catalog_cost: Decimal | null;
  effective_from: Date | null;
  cost_source: 'VARIANT' | 'SKU' | null;
  units_sold: number;
  units_with_frozen_cost: number;
  cogs_recorded: Decimal;
}

/*
 * Cuánto cuesta el inventario, producto por producto.
 *
 * El costo vive en `ProductCost` —un renglón por variante o por SKU, con
 * historial por `effective_from`— y las unidades en los artículos de los
 * pedidos de Shopify. El reporte cruza los dos: costo unitario vigente por
 * unidades vendidas en el periodo.
 *
 * Dos cosas que no es:
 *
 * - **No es un avalúo de existencias.** Nada en el esquema guarda cuántas
 *   piezas hay en bodega, así que `total_cost` valúa lo *vendido*, no lo que
 *   queda. Un producto con costo alto y sin ventas sale en cero, no en el valor
 *   de su stock.
 * - **No es el COGS del P&L.** Ese sale de `CostOfGoodsSold` ligado a cada
 *   venta y se fecha por cobro; aquí se valúa al costo de hoy y se fecha por
 *   pedido. `cogs_recorded` es el puente: lo que de verdad se cargó a
 *   resultados, para poder ver la diferencia en vez de tropezar con ella.
 */
@Injectable()
export class InventoryCostService {
  constructor(private prisma: PrismaService) {}

  async getInventoryCost(
    ctx: OwnershipContext,
    query: InventoryCostQueryDto,
  ): Promise<InventoryCostReportEntity> {
    const { startDate, endDate } = this.resolvePeriod(query);
    const ownerFilter = buildOwnerFilter(ctx);

    const [catalog, lines] = await Promise.all([
      /*
       * `effective_from <= endDate` deja fuera los costos con fecha futura: el
       * reporte dice lo que cuesta el inventario al cierre del periodo, no lo
       * que costará cuando entre en vigor el alza que alguien ya capturó.
       */
      this.prisma.productCost.findMany({
        where: { ...ownerFilter, effective_from: { lte: endDate } },
        select: {
          shopify_variant_id: true,
          sku: true,
          unit_cost: true,
          effective_from: true,
        },
        /* Ascendente: al recorrer, el costo más reciente pisa al anterior. */
        orderBy: { effective_from: 'asc' },
      }),
      this.prisma.shopifyLineItem.findMany({
        where: this.lineItemFilter(ownerFilter, { startDate, endDate }),
        select: {
          shopify_variant_id: true,
          sku: true,
          title: true,
          quantity: true,
          unit_cost: true,
          total_cost: true,
        },
        /* Igual: el nombre que queda es el de la venta más reciente. */
        orderBy: { id: 'asc' },
      }),
    ]);

    const buckets = new Map<string, Bucket>();
    /*
     * Un producto puede llegar por variante o por SKU según lo que traiga cada
     * artículo, así que los dos índices apuntan al mismo renglón. La precedencia
     * al buscar —variante primero, SKU después— es la misma que usa
     * `resolveLineItemCost` para costear la venta; si divergieran, el reporte
     * cobraría un costo distinto del que ya está en los libros.
     */
    const byVariant = new Map<string, string>();
    const bySku = new Map<string, string>();

    for (const row of catalog) {
      const key = this.identityKey(row.shopify_variant_id, row.sku, null);
      /* El esquema deja nulos los dos identificadores; el servicio no. */
      if (key === null) continue;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = this.emptyBucket(row.shopify_variant_id, row.sku);
        buckets.set(key, bucket);
      }

      bucket.catalog_cost = new Decimal(row.unit_cost);
      bucket.effective_from = row.effective_from;
      bucket.cost_source = row.shopify_variant_id ? 'VARIANT' : 'SKU';
      if (row.sku) bucket.sku = row.sku;

      if (row.shopify_variant_id) byVariant.set(row.shopify_variant_id, key);
      if (row.sku) bySku.set(row.sku, key);
    }

    const productsInCatalog = buckets.size;

    for (const line of lines) {
      const key = this.resolveKey(line, byVariant, bySku);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = this.emptyBucket(line.shopify_variant_id, line.sku);
        buckets.set(key, bucket);
      }

      /*
       * El artículo puede traer identificadores que el catálogo no tenía —o al
       * revés—; se anotan para que la siguiente venta del mismo producto caiga
       * en este renglón aunque venga identificada por el otro lado.
       */
      if (line.shopify_variant_id) {
        byVariant.set(line.shopify_variant_id, key);
        bucket.shopify_variant_id ??= line.shopify_variant_id;
      }
      if (line.sku) {
        bySku.set(line.sku, key);
        bucket.sku ??= line.sku;
      }
      if (line.title) bucket.title = line.title;

      bucket.units_sold += line.quantity;
      if (line.unit_cost !== null) {
        bucket.units_with_frozen_cost += line.quantity;
        bucket.cogs_recorded = bucket.cogs_recorded.add(line.total_cost ?? 0);
      }
    }

    await this.fillMissingTitles(buckets, byVariant, bySku, ownerFilter);

    const products = [...buckets.values()].map((bucket) =>
      this.project(bucket),
    );

    const totals = this.totals(products, productsInCatalog);
    this.sort(products, query.sort_by ?? 'total_cost', query.order ?? 'desc');

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const start = (page - 1) * limit;

    return new InventoryCostReportEntity({
      period: new InventoryCostPeriodEntity({
        start_date: startDate,
        end_date: endDate,
      }),
      totals,
      products: products.slice(start, start + limit),
      total: products.length,
      page,
      limit,
    });
  }

  /*
   * `ProductCost` no guarda el nombre del producto, sólo variante y SKU. El de
   * un producto que no se vendió en el periodo hay que ir a buscarlo a las
   * ventas de cualquier fecha; sin esto, medio catálogo saldría sin nombre y el
   * reporte sería ilegible.
   */
  private async fillMissingTitles(
    buckets: Map<string, Bucket>,
    byVariant: Map<string, string>,
    bySku: Map<string, string>,
    ownerFilter: { user_id?: number },
  ): Promise<void> {
    const pending = [...buckets.values()].filter((b) => b.title === null);
    if (pending.length === 0) return;

    const variantIds = pending
      .map((b) => b.shopify_variant_id)
      .filter((id): id is string => id !== null);
    const skus = pending
      .map((b) => b.sku)
      .filter((sku): sku is string => sku !== null);
    if (variantIds.length === 0 && skus.length === 0) return;

    const historic = await this.prisma.shopifyLineItem.findMany({
      where: {
        ...this.lineItemFilter(ownerFilter),
        OR: [
          ...(variantIds.length
            ? [{ shopify_variant_id: { in: variantIds } }]
            : []),
          ...(skus.length ? [{ sku: { in: skus } }] : []),
        ],
      },
      select: { shopify_variant_id: true, sku: true, title: true },
      orderBy: { id: 'asc' },
    });

    for (const line of historic) {
      if (!line.title) continue;
      const key =
        (line.shopify_variant_id
          ? byVariant.get(line.shopify_variant_id)
          : undefined) ?? (line.sku ? bySku.get(line.sku) : undefined);
      if (key === undefined) continue;
      const bucket = buckets.get(key);
      if (bucket) bucket.title = line.title;
    }
  }

  private project(bucket: Bucket): InventoryCostProductEntity {
    let unitCost = bucket.catalog_cost;
    let costSource: 'VARIANT' | 'SKU' | 'FROZEN' | null = bucket.cost_source;

    /*
     * Producto vendido que nadie costeó en el catálogo: si Shopify mandó el
     * costo con la venta, se usa ese —promediado por unidad, porque puede haber
     * cambiado entre pedidos—. Vale menos que el catálogo, pero deja el renglón
     * con una cifra en vez de un hueco.
     */
    if (unitCost === null && bucket.units_with_frozen_cost > 0) {
      unitCost = divideMoney(
        bucket.cogs_recorded,
        bucket.units_with_frozen_cost,
      );
      costSource = unitCost === null ? null : 'FROZEN';
    }

    return new InventoryCostProductEntity({
      shopify_variant_id: bucket.shopify_variant_id,
      sku: bucket.sku,
      title: bucket.title,
      unit_cost: unitCost === null ? null : (toMoneyNumber(unitCost) ?? 0),
      effective_from: bucket.effective_from,
      cost_source: costSource,
      in_catalog: bucket.catalog_cost !== null,
      units_sold: bucket.units_sold,
      total_cost:
        unitCost === null
          ? null
          : (toMoneyNumber(unitCost.times(bucket.units_sold)) ?? 0),
      cogs_recorded: toMoneyNumber(bucket.cogs_recorded) ?? 0,
    });
  }

  private totals(
    products: InventoryCostProductEntity[],
    productsInCatalog: number,
  ): InventoryCostTotalsEntity {
    let totalCost = new Decimal(0);
    let cogsRecorded = new Decimal(0);
    let unitsSold = 0;
    let unitsWithoutCost = 0;
    let productsWithoutCost = 0;
    let productsWithoutSales = 0;

    for (const product of products) {
      unitsSold += product.units_sold;
      cogsRecorded = cogsRecorded.add(product.cogs_recorded);
      if (product.total_cost !== null)
        totalCost = totalCost.add(product.total_cost);
      /*
       * La cobertura se mide sobre las unidades cuyo *costo unitario* se
       * conoce, no sobre las que traían costo congelado: a un producto del
       * catálogo se le valúa toda su venta aunque Shopify no mandara nada.
       */
      if (product.unit_cost === null) {
        productsWithoutCost++;
        unitsWithoutCost += product.units_sold;
      }
      if (product.in_catalog && product.units_sold === 0)
        productsWithoutSales++;
    }

    return new InventoryCostTotalsEntity({
      products_in_catalog: productsInCatalog,
      products_listed: products.length,
      products_without_cost: productsWithoutCost,
      products_without_sales: productsWithoutSales,
      units_sold: unitsSold,
      units_without_cost: unitsWithoutCost,
      total_cost: toMoneyNumber(totalCost) ?? 0,
      cogs_recorded: toMoneyNumber(cogsRecorded) ?? 0,
      cost_coverage: percentage(unitsSold - unitsWithoutCost, unitsSold),
    });
  }

  /* Sin costo conocido siempre al final, se ordene como se ordene. */
  private sort(
    products: InventoryCostProductEntity[],
    sortBy: 'total_cost' | 'unit_cost' | 'units_sold' | 'cogs_recorded',
    order: 'asc' | 'desc',
  ): void {
    products.sort((a, b) => {
      const left = a[sortBy];
      const right = b[sortBy];
      if (left === null && right === null) return this.byName(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === right) return this.byName(a, b);
      return order === 'desc' ? right - left : left - right;
    });
  }

  private byName(
    a: InventoryCostProductEntity,
    b: InventoryCostProductEntity,
  ): number {
    return (a.title ?? a.sku ?? '').localeCompare(b.title ?? b.sku ?? '');
  }

  private resolveKey(
    line: {
      shopify_variant_id: string | null;
      sku: string | null;
      title: string;
    },
    byVariant: Map<string, string>,
    bySku: Map<string, string>,
  ): string {
    const known =
      (line.shopify_variant_id
        ? byVariant.get(line.shopify_variant_id)
        : undefined) ?? (line.sku ? bySku.get(line.sku) : undefined);
    if (known !== undefined) return known;
    return (
      this.identityKey(line.shopify_variant_id, line.sku, line.title) ??
      UNIDENTIFIED_KEY
    );
  }

  /*
   * Un artículo sin variante ni SKU sólo se puede agrupar por nombre. Es
   * frágil, pero mandarlo a un renglón por venta sería peor: el reporte se
   * llenaría de duplicados del mismo producto.
   */
  private identityKey(
    variantId: string | null,
    sku: string | null,
    title: string | null,
  ): string | null {
    if (variantId) return `variant:${variantId}`;
    if (sku) return `sku:${sku}`;
    if (title) return `title:${title}`;
    return null;
  }

  private lineItemFilter(
    ownerFilter: { user_id?: number },
    range?: { startDate: Date; endDate: Date },
  ): Prisma.ShopifyLineItemWhereInput {
    const order: Prisma.ShopifyOrderWhereInput = {
      ...(range
        ? { created_at: { gte: range.startDate, lte: range.endDate } }
        : {}),
      ...(ownerFilter.user_id
        ? { shopify_connection: { user_id: ownerFilter.user_id } }
        : {}),
    };
    return Object.keys(order).length > 0 ? { shopify_order: order } : {};
  }

  private emptyBucket(variantId: string | null, sku: string | null): Bucket {
    return {
      shopify_variant_id: variantId,
      sku,
      title: null,
      catalog_cost: null,
      effective_from: null,
      cost_source: null,
      units_sold: 0,
      units_with_frozen_cost: 0,
      cogs_recorded: new Decimal(0),
    };
  }

  /*
   * Sin periodo, el mes en curso *de la tienda*: con la zona del servidor —UTC
   * en el contenedor— el día 1 antes de las 06:00 el reporte ya habría saltado
   * al mes siguiente mientras el negocio sigue cerrando el anterior.
   */
  private resolvePeriod(query: InventoryCostQueryDto): {
    startDate: Date;
    endDate: Date;
  } {
    const hasYear = query.year !== undefined;
    const hasMonth = query.month !== undefined;
    const hasStart = query.start_date !== undefined;
    const hasEnd = query.end_date !== undefined;

    if (hasYear !== hasMonth) {
      throw new BadRequestException('Provide both year and month');
    }
    if (hasStart !== hasEnd) {
      throw new BadRequestException('Provide both start_date and end_date');
    }
    if (hasYear && hasStart) {
      throw new BadRequestException(
        'Use either year+month or start_date+end_date, not both',
      );
    }

    if (hasStart) {
      const startDate = startOfDayInZone(query.start_date!);
      const endDate = endOfDayInZone(query.end_date!);
      if (startDate > endDate) {
        throw new BadRequestException('start_date must be before end_date');
      }
      return { startDate, endDate };
    }

    const { year, month } = hasYear
      ? { year: query.year!, month: query.month! }
      : currentMonthInZone();
    return monthRangeInZone(year, month);
  }
}
