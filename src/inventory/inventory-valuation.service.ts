import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { percentage, toMoneyNumber } from '../common/money';
import { endOfDayInZone } from '../common/timezone';
import { InventoryValuationQueryDto } from './dto/inventory-valuation-query.dto';
import {
  InventoryValuationProductEntity,
  InventoryValuationReportEntity,
  InventoryValuationSourceEntity,
  InventoryValuationTotalsEntity,
} from './entities/inventory-valuation.entity';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

interface Bucket {
  shopify_variant_id: string | null;
  sku: string | null;
  title: string;
  quantity_on_hand: number | null;
  unit_cost: Decimal | null;
  cost_source: string | null;
  total_cost: Decimal | null;
  tracked: boolean;
}

/*
 * Cuánto vale la mercancía que está en el anaquel.
 *
 * Lee una foto guardada; no consulta Shopify. El costo ya viene congelado en
 * cada renglón desde que se tomó, así que el avalúo de una fecha pasada da hoy
 * lo mismo que dio entonces.
 *
 * No es costeo PEPS ni promedio ponderado: `unitCost` de Shopify es un número
 * que alguien captura a mano, así que un alza de costo revalúa hacia arriba
 * mercancía que se compró barata. Sirve para saber cuánto dinero está parado;
 * no es un costo de ventas fiscal.
 */
@Injectable()
export class InventoryValuationService {
  constructor(private prisma: PrismaService) {}

  async getValuation(
    ctx: OwnershipContext,
    query: InventoryValuationQueryDto,
  ): Promise<InventoryValuationReportEntity> {
    if (query.snapshot_id !== undefined && query.as_of !== undefined) {
      throw new BadRequestException(
        'Use either snapshot_id or as_of, not both',
      );
    }

    const snapshots = await this.resolveSnapshots(ctx, query);

    const items = await this.prisma.inventorySnapshotItem.findMany({
      where: { snapshot_id: { in: snapshots.map((s) => s.id) } },
      select: {
        shopify_variant_id: true,
        sku: true,
        title: true,
        quantity_on_hand: true,
        tracked: true,
        unit_cost: true,
        total_cost: true,
        cost_source: true,
      },
    });

    /*
     * La captura ya suma las sucursales en un renglón por variante, pero se
     * agrupa igual: una foto vieja —o dos conexiones con el mismo SKU— sí traen
     * varios renglones del mismo producto.
     */
    const buckets = new Map<string, Bucket>();
    for (const item of items) {
      const key = item.shopify_variant_id ?? item.sku ?? item.title;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          shopify_variant_id: item.shopify_variant_id,
          sku: item.sku,
          title: item.title,
          quantity_on_hand: null,
          unit_cost: null,
          cost_source: null,
          total_cost: null,
          tracked: false,
        };
        buckets.set(key, bucket);
      }

      if (item.tracked) bucket.tracked = true;
      if (item.quantity_on_hand !== null) {
        bucket.quantity_on_hand =
          (bucket.quantity_on_hand ?? 0) + item.quantity_on_hand;
      }
      if (item.unit_cost !== null && bucket.unit_cost === null) {
        bucket.unit_cost = new Decimal(item.unit_cost);
        bucket.cost_source = item.cost_source;
      }
      if (item.total_cost !== null) {
        bucket.total_cost = (bucket.total_cost ?? new Decimal(0)).add(
          item.total_cost,
        );
      }
    }

    const products = [...buckets.values()].map(
      (bucket) =>
        new InventoryValuationProductEntity({
          shopify_variant_id: bucket.shopify_variant_id,
          sku: bucket.sku,
          title: bucket.title,
          quantity_on_hand: bucket.quantity_on_hand,
          unit_cost:
            bucket.unit_cost === null ? null : toMoneyNumber(bucket.unit_cost),
          cost_source: bucket.cost_source,
          total_cost:
            bucket.total_cost === null
              ? null
              : toMoneyNumber(bucket.total_cost),
        }),
    );

    const totals = this.totals([...buckets.values()]);
    this.sort(products, query.sort_by ?? 'total_cost', query.order ?? 'desc');

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const start = (page - 1) * limit;

    return new InventoryValuationReportEntity({
      source: new InventoryValuationSourceEntity({
        snapshot_ids: snapshots.map((s) => s.id),
        taken_at: snapshots[0].taken_at,
        connections: snapshots.length,
      }),
      totals,
      products: products.slice(start, start + limit),
      total: products.length,
      page,
      limit,
    });
  }

  /*
   * Con una sola conexión —el caso normal— esto es «la foto más reciente». Con
   * varias se toma la más reciente **de cada una** y se suman: quedarse sólo
   * con la última dejaría fuera el inventario de la otra tienda sin decirlo,
   * que es la clase de subconteo silencioso que este proyecto evita.
   */
  private async resolveSnapshots(
    ctx: OwnershipContext,
    query: InventoryValuationQueryDto,
  ): Promise<{ id: number; taken_at: Date; shopify_connection_id: number }[]> {
    const ownerFilter = buildOwnerFilter(ctx);

    if (query.snapshot_id !== undefined) {
      const snapshot = await this.prisma.inventorySnapshot.findFirst({
        where: { id: query.snapshot_id, ...ownerFilter, status: 'COMPLETE' },
        select: { id: true, taken_at: true, shopify_connection_id: true },
      });
      if (!snapshot) {
        throw new NotFoundException(
          `No hay ninguna foto de inventario completa con id ${query.snapshot_id}.`,
        );
      }
      return [snapshot];
    }

    const asOf = query.as_of ? endOfDayInZone(query.as_of) : undefined;

    const rows = await this.prisma.inventorySnapshot.findMany({
      where: {
        ...ownerFilter,
        status: 'COMPLETE',
        ...(asOf ? { taken_at: { lte: asOf } } : {}),
      },
      select: { id: true, taken_at: true, shopify_connection_id: true },
      orderBy: { taken_at: 'desc' },
    });

    const latest = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.shopify_connection_id))
        latest.set(row.shopify_connection_id, row);
    }

    /*
     * Devolver totales en cero haría pasar «nunca he tomado una foto» por
     * «tengo el almacén vacío», que son cosas muy distintas.
     */
    if (latest.size === 0) {
      throw new NotFoundException(
        asOf
          ? 'No hay ninguna foto de inventario tomada en o antes de esa fecha.'
          : 'Todavía no hay ninguna foto de inventario. Toma la primera con POST /inventory/snapshots.',
      );
    }

    return [...latest.values()];
  }

  private totals(buckets: Bucket[]): InventoryValuationTotalsEntity {
    let totalUnits = 0;
    let unitsWithoutCost = 0;
    let totalCost = new Decimal(0);
    let valued = 0;
    let withoutCost = 0;
    let untracked = 0;

    for (const bucket of buckets) {
      if (bucket.quantity_on_hand !== null)
        totalUnits += bucket.quantity_on_hand;
      if (bucket.total_cost !== null)
        totalCost = totalCost.add(bucket.total_cost);
      if (bucket.unit_cost === null) {
        withoutCost++;
        if (bucket.quantity_on_hand !== null)
          unitsWithoutCost += bucket.quantity_on_hand;
      } else {
        valued++;
      }
      if (!bucket.tracked) untracked++;
    }

    return new InventoryValuationTotalsEntity({
      products: buckets.length,
      products_valued: valued,
      products_without_cost: withoutCost,
      products_untracked: untracked,
      total_units: totalUnits,
      units_without_cost: unitsWithoutCost,
      total_cost: toMoneyNumber(totalCost) ?? 0,
      cost_coverage: percentage(totalUnits - unitsWithoutCost, totalUnits),
    });
  }

  /* Sin costo siempre al final, se ordene como se ordene. */
  private sort(
    products: InventoryValuationProductEntity[],
    sortBy: 'total_cost' | 'unit_cost' | 'quantity_on_hand',
    order: 'asc' | 'desc',
  ): void {
    products.sort((a, b) => {
      const left = a[sortBy];
      const right = b[sortBy];
      if (left === null && right === null)
        return a.title.localeCompare(b.title);
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === right) return a.title.localeCompare(b.title);
      return order === 'desc' ? right - left : left - right;
    });
  }
}
