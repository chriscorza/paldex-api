import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import {
  InventoryLevelRow,
  ShopifyInventorySyncService,
} from '../shopify/shopify-inventory-sync.service';
import { InventorySnapshotsQueryDto } from './dto/inventory-valuation-query.dto';
import {
  INVENTORY_SNAPSHOT_SELECT,
  InventorySnapshotEntity,
  InventorySnapshotListEntity,
} from './entities/inventory-snapshot.entity';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type InventoryCostSource = 'VARIANT' | 'SKU' | 'SHOPIFY';

interface CostCatalog {
  byVariant: Map<string, Decimal>;
  bySku: Map<string, Decimal>;
}

interface ValuedRow extends InventoryLevelRow {
  unit_cost: Decimal | null;
  total_cost: Decimal | null;
  cost_source: InventoryCostSource | null;
  unit_price: Decimal | null;
  total_price: Decimal | null;
}

/*
 * Toma la foto de las existencias y la valúa en el momento de tomarla.
 *
 * El costo se **congela en el renglón**: no se recalcula al leer el avalúo. Si
 * se recalculara, corregir hoy un `ProductCost` cambiaría el avalúo de julio, y
 * una foto es un hecho fechado —ese es justamente el motivo de guardarlas—.
 *
 * La foto nace en `PENDING` y sólo pasa a `COMPLETE` cuando la captura termina
 * entera. Sin eso, un timeout a media paginación dejaría un avalúo que parece
 * bueno y está a la mitad.
 */
@Injectable()
export class InventorySnapshotService {
  private readonly logger = new Logger(InventorySnapshotService.name);

  constructor(
    private prisma: PrismaService,
    private inventorySync: ShopifyInventorySyncService,
  ) {}

  async captureForOwner(ctx: OwnershipContext) {
    const connections = await this.prisma.shopifyConnection.findMany({
      where: { ...buildOwnerFilter(ctx), status: 'ACTIVE' },
      select: { id: true, user_id: true },
    });

    if (connections.length === 0) {
      throw new BadRequestException(
        'No hay ninguna conexión de Shopify activa de la que tomar existencias.',
      );
    }

    const snapshots = [];
    for (const connection of connections) {
      snapshots.push(await this.capture(connection.id, connection.user_id));
    }
    return snapshots;
  }

  async listSnapshots(
    ctx: OwnershipContext,
    query: InventorySnapshotsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = buildOwnerFilter(ctx);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventorySnapshot.findMany({
        where,
        select: INVENTORY_SNAPSHOT_SELECT,
        orderBy: { taken_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventorySnapshot.count({ where }),
    ]);

    return new InventorySnapshotListEntity({
      data: rows.map((row) => new InventorySnapshotEntity(row)),
      total,
      page,
      limit,
    });
  }

  async capture(connectionId: number, userId: number) {
    const snapshot = await this.prisma.inventorySnapshot.create({
      data: {
        shopify_connection_id: connectionId,
        user_id: userId,
        status: 'PENDING',
      },
    });

    try {
      const rows = await this.inventorySync.fetchInventory(connectionId);
      const catalog = await this.loadCostCatalog(userId, snapshot.taken_at);
      const valued = rows.map((row) => this.value(row, catalog));

      if (valued.length > 0) {
        await this.prisma.inventorySnapshotItem.createMany({
          data: valued.map((row) => ({
            snapshot_id: snapshot.id,
            shopify_variant_id: row.shopify_variant_id,
            shopify_inventory_item_id: row.shopify_inventory_item_id,
            sku: row.sku,
            title: row.title,
            location_name: row.location_name,
            quantity_on_hand: row.quantity_on_hand,
            tracked: row.tracked,
            unit_cost: row.unit_cost,
            total_cost: row.total_cost,
            cost_source: row.cost_source,
            unit_price: row.unit_price,
            total_price: row.total_price,
          })),
        });
      }

      await this.seedProductCosts(userId, rows, catalog);

      return await this.prisma.inventorySnapshot.update({
        where: { id: snapshot.id },
        data: { status: 'COMPLETE', ...this.totals(valued) },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Falló la foto de inventario de la conexión ${connectionId}: ${reason}`,
      );
      /*
       * Los renglones que alcanzaron a escribirse se quedan: sirven para
       * depurar. Lo que no puede pasar es que el avalúo los tome por buenos,
       * y por eso mira sólo fotos COMPLETE.
       */
      await this.prisma.inventorySnapshot.update({
        where: { id: snapshot.id },
        data: { status: 'FAILED', failure_reason: reason.slice(0, 190) },
      });
      throw error;
    }
  }

  /*
   * Misma precedencia que `resolveLineItemCost` (`src/shopify/cost-resolver.ts`)
   * salvo el costo congelado en la venta, que aquí no aplica: mercancía sin
   * vender no tiene venta donde congelarse. Si cambia una, hay que cambiar la
   * otra, o el avalúo cobraría un costo distinto del que ya está en los libros.
   */
  private value(row: InventoryLevelRow, catalog: CostCatalog): ValuedRow {
    let unitCost: Decimal | null = null;
    let source: InventoryCostSource | null = null;

    const byVariant = row.shopify_variant_id
      ? catalog.byVariant.get(row.shopify_variant_id)
      : undefined;
    const bySku = row.sku ? catalog.bySku.get(row.sku) : undefined;

    if (byVariant !== undefined) {
      unitCost = byVariant;
      source = 'VARIANT';
    } else if (bySku !== undefined) {
      unitCost = bySku;
      source = 'SKU';
    } else if (row.shopify_unit_cost !== null) {
      unitCost = new Decimal(row.shopify_unit_cost);
      source = 'SHOPIFY';
    }

    /*
     * Sin piezas conocidas no hay costo total que calcular, aunque sí se sepa
     * el unitario. Un cero diría que esa mercancía no vale nada.
     */
    const totalCost =
      unitCost === null || row.quantity_on_hand === null
        ? null
        : unitCost.times(row.quantity_on_hand);

    /*
     * El precio de lista es de Shopify y sólo de ahí: es lo que la tienda pide
     * hoy por la pieza, sin descuentos ni promociones. No se cruza con
     * `ProductCost`, que es la otra mitad del par —lo que costó, no lo que vale.
     */
    const unitPrice =
      row.shopify_unit_price === null
        ? null
        : new Decimal(row.shopify_unit_price);
    const totalPrice =
      unitPrice === null || row.quantity_on_hand === null
        ? null
        : unitPrice.times(row.quantity_on_hand);

    return {
      ...row,
      unit_cost: unitCost,
      total_cost: totalCost,
      cost_source: source,
      unit_price: unitPrice,
      total_price: totalPrice,
    };
  }

  /*
   * El vigente a la fecha de la foto: se descarta el `effective_from` futuro
   * —un alza ya capturada que aún no entra— y entre los vigentes gana el más
   * reciente, que es el último que se recorre al venir ordenados ascendente.
   */
  private async loadCostCatalog(
    userId: number,
    takenAt: Date,
  ): Promise<CostCatalog> {
    const rows = await this.prisma.productCost.findMany({
      where: { user_id: userId, effective_from: { lte: takenAt } },
      select: { shopify_variant_id: true, sku: true, unit_cost: true },
      orderBy: { effective_from: 'asc' },
    });

    const catalog: CostCatalog = { byVariant: new Map(), bySku: new Map() };
    for (const row of rows) {
      const cost = new Decimal(row.unit_cost);
      if (row.shopify_variant_id)
        catalog.byVariant.set(row.shopify_variant_id, cost);
      if (row.sku) catalog.bySku.set(row.sku, cost);
    }
    return catalog;
  }

  /*
   * El costo que Shopify ya conoce se copia al catálogo del dueño, marcado con
   * su origen. Así el catálogo se llena solo y el siguiente avalúo —y el costeo
   * de las ventas, que lee la misma tabla— dejan de depender de que Shopify lo
   * mande.
   */
  private async seedProductCosts(
    userId: number,
    rows: InventoryLevelRow[],
    catalog: CostCatalog,
  ): Promise<void> {
    const pending = new Map<string, InventoryLevelRow>();

    for (const row of rows) {
      if (row.shopify_unit_cost === null || row.shopify_unit_cost <= 0)
        continue;
      if (!row.shopify_variant_id && !row.sku) continue;
      if (
        row.shopify_variant_id &&
        catalog.byVariant.has(row.shopify_variant_id)
      )
        continue;
      if (row.sku && catalog.bySku.has(row.sku)) continue;

      /* La misma variante llega una vez por sucursal: basta con sembrarla una. */
      const key = row.shopify_variant_id ?? `sku:${row.sku}`;
      if (!pending.has(key)) pending.set(key, row);
    }

    if (pending.size === 0) return;

    await this.prisma.productCost.createMany({
      data: [...pending.values()].map((row) => ({
        shopify_variant_id: row.shopify_variant_id,
        sku: row.sku,
        unit_cost: new Decimal(row.shopify_unit_cost!),
        source: 'SHOPIFY_INVENTORY' as const,
        notes: 'Sembrado desde el inventario de Shopify',
        user_id: userId,
      })),
    });

    this.logger.log(
      `Sembrados ${pending.size} costos desde el inventario de Shopify para el usuario ${userId}`,
    );
  }

  /*
   * Se cuenta por producto, no por renglón: una variante en dos sucursales son
   * dos renglones y un solo producto.
   */
  private totals(rows: ValuedRow[]) {
    let totalUnits = 0;
    let totalCost = new Decimal(0);
    let retailValue = new Decimal(0);
    const valued = new Set<string>();
    const withoutCost = new Set<string>();
    const untracked = new Set<string>();

    for (const row of rows) {
      const key = row.shopify_variant_id ?? row.sku ?? row.title;
      if (row.quantity_on_hand !== null) totalUnits += row.quantity_on_hand;
      if (row.total_cost !== null) totalCost = totalCost.add(row.total_cost);
      if (row.total_price !== null)
        retailValue = retailValue.add(row.total_price);
      if (row.unit_cost === null) withoutCost.add(key);
      else valued.add(key);
      if (!row.tracked) untracked.add(key);
    }

    return {
      total_units: totalUnits,
      total_cost: totalCost,
      retail_value: retailValue,
      products_valued: valued.size,
      products_without_cost: withoutCost.size,
      variants_untracked: untracked.size,
    };
  }
}
