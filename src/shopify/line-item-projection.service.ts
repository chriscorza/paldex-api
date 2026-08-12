import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { resolveCategory } from './category-resolver';
import { resolveLineItemCost } from './cost-resolver';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';

@Injectable()
export class LineItemProjectionService {
  constructor(private prisma: PrismaService) {}

  async projectOrder(orderId: number, _ctx?: OwnershipContext) {
    const order = await this.prisma.shopifyOrder.findUnique({
      where: { id: orderId },
      include: {
        shopify_connection: { select: { user_id: true } },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    const lineItems = this.parseLineItems(order.line_items);
    if (!Array.isArray(lineItems)) return;

    const userId = order.shopify_connection.user_id;

    const overrides = await this.prisma.productCategoryOverride.findMany({
      where: { user_id: userId },
    });
    const overrideMap = new Map(
      overrides.map((o) => [o.shopify_product_id, o.category_name]),
    );

    const nowLineItemIds = new Set<string>();

    for (const item of lineItems) {
      const li = item as any;
      const lineItemId = String(li.id);
      nowLineItemIds.add(lineItemId);

      const shopifyProductId = li.product_id ? String(li.product_id) : null;
      const shopifyVariantId = li.variant_id ? String(li.variant_id) : null;
      const sku = li.sku || null;

      const category = resolveCategory(
        shopifyProductId ? overrideMap.get(shopifyProductId) : null,
        li.product_type || null,
        li.collections || null,
        li.tags || null,
      );

      const quantity = parseInt(String(li.quantity) || '1', 10) || 0;
      const unitPrice = new Decimal(li.price || 0);
      const grossSales = unitPrice.times(quantity);

      /*
       * Los descuentos y los impuestos vienen en el propio artículo —tanto del
       * webhook como del backfill, que los traduce a la forma REST— y ya están
       * calculados para toda la cantidad, no por unidad. Antes se guardaban en
       * cero a pelo, así que `net_sales` era en realidad el bruto y los
       * márgenes por categoría salían inflados por el total de descuentos.
       */
      const discountAllocated = this.sumAmounts(
        li.discount_allocations,
        'amount',
      );
      const taxAllocated = this.sumAmounts(li.tax_lines, 'price');

      /*
       * El impuesto no se resta: `net_sales` es bruto menos descuentos, la
       * misma definición que usa Shopify en sus reportes. `tax_allocated` se
       * guarda aparte para poder cuadrar contra el pedido.
       */
      const netSales = grossSales.minus(discountAllocated);

      const frozenCost = li.cost
        ? Number(li.cost)
        : li.unit_cost
          ? Number(li.unit_cost)
          : null;

      let unitCost: number | null = null;
      let totalCost: Decimal | null = null;
      let grossProfit: Decimal | null = null;
      let profitMargin: Decimal | null = null;

      if (shopifyVariantId || sku) {
        const variantCosts = shopifyVariantId
          ? (
              await this.prisma.productCost.findMany({
                where: {
                  shopify_variant_id: shopifyVariantId,
                  user_id: userId,
                },
                select: { unit_cost: true, effective_from: true },
              })
            ).map((c) => ({
              unit_cost: Number(c.unit_cost),
              effective_from: c.effective_from,
            }))
          : [];
        const skuCosts = sku
          ? (
              await this.prisma.productCost.findMany({
                where: { sku, user_id: userId },
                select: { unit_cost: true, effective_from: true },
              })
            ).map((c) => ({
              unit_cost: Number(c.unit_cost),
              effective_from: c.effective_from,
            }))
          : [];

        const resolved = resolveLineItemCost(
          frozenCost,
          variantCosts,
          skuCosts,
          order.created_at,
        );

        unitCost = resolved.unit_cost;
      } else if (frozenCost !== null && frozenCost !== undefined) {
        unitCost = frozenCost;
      }

      if (unitCost !== null) {
        totalCost = new Decimal(unitCost).times(quantity);
        grossProfit = netSales.minus(totalCost);
        if (!netSales.isZero()) {
          profitMargin = grossProfit.dividedBy(netSales).times(100).toDP(2);
        }
      }

      const title = String(li.title || li.name || '');

      await this.prisma.shopifyLineItem.upsert({
        where: {
          shopify_order_id_shopify_line_item_id: {
            shopify_order_id: orderId,
            shopify_line_item_id: lineItemId,
          },
        },
        create: {
          shopify_order_id: orderId,
          shopify_line_item_id: lineItemId,
          shopify_product_id: shopifyProductId,
          shopify_variant_id: shopifyVariantId,
          sku,
          title,
          variant_title: li.variant_title ? String(li.variant_title) : null,
          quantity,
          unit_price: unitPrice.toNumber(),
          discount_allocated: discountAllocated.toNumber(),
          tax_allocated: taxAllocated.toNumber(),
          category_name: category.name,
          category_source: category.source,
          unit_cost: unitCost,
          total_cost: totalCost ? totalCost.toNumber() : null,
          gross_sales: grossSales.toNumber(),
          net_sales: netSales.toNumber(),
          gross_profit: grossProfit ? grossProfit.toNumber() : null,
          profit_margin: profitMargin ? profitMargin.toNumber() : null,
        },
        update: {
          shopify_product_id: shopifyProductId,
          shopify_variant_id: shopifyVariantId,
          sku,
          title,
          variant_title: li.variant_title ? String(li.variant_title) : null,
          quantity,
          unit_price: unitPrice.toNumber(),
          discount_allocated: discountAllocated.toNumber(),
          tax_allocated: taxAllocated.toNumber(),
          category_name: category.name,
          category_source: category.source,
          unit_cost: unitCost,
          total_cost: totalCost ? totalCost.toNumber() : null,
          gross_sales: grossSales.toNumber(),
          net_sales: netSales.toNumber(),
          gross_profit: grossProfit ? grossProfit.toNumber() : null,
          profit_margin: profitMargin ? profitMargin.toNumber() : null,
        },
      });
    }

    const existing = await this.prisma.shopifyLineItem.findMany({
      where: { shopify_order_id: orderId },
      select: { shopify_line_item_id: true },
    });

    for (const el of existing) {
      if (!nowLineItemIds.has(el.shopify_line_item_id)) {
        await this.prisma.shopifyLineItem.deleteMany({
          where: {
            shopify_order_id: orderId,
            shopify_line_item_id: el.shopify_line_item_id,
          },
        });
      }
    }

    await this.recalculateOrderAggregates(orderId);
    await this.propagateToIncomes(orderId);
  }

  async recalculateCosts(
    startDate: string,
    endDate: string,
    ctx?: OwnershipContext,
  ) {
    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const orders = await this.prisma.shopifyOrder.findMany({
      where: {
        created_at: { gte: new Date(startDate), lte: new Date(endDate) },
        ...(ownerFilter.user_id
          ? { shopify_connection: { user_id: ownerFilter.user_id } }
          : {}),
      },
      select: { id: true },
    });

    let changes = 0;
    for (const { id } of orders) {
      const before = await this.prisma.shopifyLineItem.findMany({
        where: { shopify_order_id: id },
        select: { id: true, unit_cost: true, gross_profit: true },
      });
      await this.projectOrder(id, ctx);
      const after = await this.prisma.shopifyLineItem.findMany({
        where: { shopify_order_id: id },
        select: { id: true, unit_cost: true, gross_profit: true },
      });
      const changed =
        before.some((b) => {
          const a = after.find((x) => x.id === b.id);
          return (
            a &&
            (Number(b.unit_cost ?? 0) !== Number(a.unit_cost ?? 0) ||
              Number(b.gross_profit ?? 0) !== Number(a.gross_profit ?? 0))
          );
        }) || before.length !== after.length;
      if (changed) changes++;
    }

    return { processed: orders.length, changes };
  }

  private async recalculateOrderAggregates(orderId: number) {
    const agg = await this.prisma.shopifyLineItem.aggregate({
      where: { shopify_order_id: orderId },
      _sum: { total_cost: true, gross_profit: true },
      _count: { id: true },
    });

    const allLines = await this.prisma.shopifyLineItem.findMany({
      where: { shopify_order_id: orderId },
      select: { unit_cost: true },
    });

    const missingCost = allLines.some((l) => l.unit_cost === null);

    await this.prisma.shopifyOrder.update({
      where: { id: orderId },
      data: {
        cost_total: Number(agg._sum.total_cost ?? 0),
        profit_total: Number(agg._sum.gross_profit ?? 0),
        has_missing_cost_data: missingCost,
      },
    });
  }

  /*
   * Pública a propósito: en el backfill —y también con los webhooks— el pedido
   * se proyecta antes de que existan sus transacciones, así que aquí todavía no
   * hay ningún income al que colgarle el costo. Quien crea el income
   * (`ShopifyTransactionSyncService`) vuelve a llamar a este método para cerrar
   * el círculo. Sin esa segunda llamada, los ingresos de Shopify se quedaban con
   * `cogs_total` en NULL para siempre.
   */
  async propagateToIncomes(orderId: number) {
    const incomes = await this.prisma.income.findMany({
      where: { shopify_order_id: orderId },
      select: { id: true, net_amount: true },
      orderBy: { id: 'asc' },
    });

    if (incomes.length === 0) return;

    const cogsAgg = await this.prisma.shopifyLineItem.aggregate({
      where: { shopify_order_id: orderId },
      _sum: { total_cost: true },
    });

    const cogsTotal = cogsAgg._sum.total_cost;

    /* Pedido sin ningún costo conocido: se limpia lo que hubiera de antes. */
    if (cogsTotal === null || cogsTotal === undefined) {
      for (const income of incomes) {
        await this.prisma.income.update({
          where: { id: income.id },
          data: { cogs_total: null, profit_gross: null },
        });
        await this.prisma.costOfGoodsSold.deleteMany({
          where: { income_id: income.id, source: 'SHOPIFY' },
        });
      }
      return;
    }

    const order = await this.prisma.shopifyOrder.findUnique({
      where: { id: orderId },
      select: { order_number: true },
    });

    const shares = this.splitCostByNetAmount(new Decimal(cogsTotal), incomes);

    for (const [index, income] of incomes.entries()) {
      const share = shares[index];
      const profit =
        income.net_amount !== null
          ? new Decimal(income.net_amount).minus(share).toNumber()
          : null;

      await this.prisma.income.update({
        where: { id: income.id },
        data: { cogs_total: share.toNumber(), profit_gross: profit },
      });

      /*
       * El P&L mensual toma el COGS de `CostOfGoodsSold`, no de
       * `income.cogs_total` (ver la regla de no-duplicación en CLAUDE.md), así
       * que la venta de Shopify tiene que materializar su fila. Se reescribe en
       * cada proyección —borrando sólo las de origen SHOPIFY— para que
       * reimportar no duplique el costo ni pise las filas manuales.
       *
       * Es una fila agregada por income, no una por artículo: con un pago
       * partido el costo va a prorrata y ya no hay forma de repartir cada
       * artículo entre las transacciones sin inventarse la asignación.
       */
      await this.prisma.costOfGoodsSold.deleteMany({
        where: { income_id: income.id, source: 'SHOPIFY' },
      });

      if (!share.isZero()) {
        await this.prisma.costOfGoodsSold.create({
          data: {
            income_id: income.id,
            product_reference:
              order?.order_number != null
                ? `Shopify #${order.order_number}`
                : null,
            quantity: 1,
            unit_cost: share.toNumber(),
            total_cost: share.toNumber(),
            source: 'SHOPIFY',
          },
        });
      }
    }
  }

  /*
   * Un pedido cobrado en varias transacciones crea un income por cada una. El
   * costo se reparte a prorrata del neto de cada uno; darle el total del pedido
   * a cada income —lo que se hacía antes— multiplicaba el COGS por el número de
   * pagos. El resto de los centavos va al último para que la suma cuadre exacta
   * con el costo del pedido.
   */
  private splitCostByNetAmount(
    total: Decimal,
    incomes: { net_amount: unknown }[],
  ): Decimal[] {
    const nets = incomes.map((i) => new Decimal((i.net_amount ?? 0) as any));
    const netTotal = nets.reduce((sum, n) => sum.plus(n), new Decimal(0));

    const shares: Decimal[] = [];
    let assigned = new Decimal(0);

    for (let i = 0; i < incomes.length; i++) {
      if (i === incomes.length - 1) {
        shares.push(total.minus(assigned));
        break;
      }
      const share = netTotal.isZero()
        ? total.dividedBy(incomes.length).toDP(2)
        : total.times(nets[i]).dividedBy(netTotal).toDP(2);
      shares.push(share);
      assigned = assigned.plus(share);
    }

    return shares;
  }

  /*
   * Suma una lista de importes de Shopify tolerando que no venga, que venga
   * vacía o que traiga entradas sin el campo: un artículo sin descuento no debe
   * romper la proyección del pedido entero.
   */
  private sumAmounts(list: any, key: string): Decimal {
    if (!Array.isArray(list)) return new Decimal(0);

    return list.reduce((sum: Decimal, entry: any) => {
      const raw = entry?.[key];
      /* `new Decimal('lo que sea')` lanza; se valida antes de construirlo. */
      if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) {
        return sum;
      }
      return sum.plus(new Decimal(raw));
    }, new Decimal(0));
  }

  private parseLineItems(lineItems: any): any[] {
    if (Array.isArray(lineItems)) return lineItems;
    if (typeof lineItems === 'string') {
      try {
        return JSON.parse(lineItems);
      } catch {
        return [];
      }
    }
    return [];
  }
}
