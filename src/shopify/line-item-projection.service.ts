import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { resolveCategory } from './category-resolver';
import { resolveLineItemCost } from './cost-resolver';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;
import { OwnershipContext } from '../common/ownership';

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
      const discountAllocated = new Decimal(0);
      const netSales = grossSales.minus(discountAllocated);
      const taxAllocated = new Decimal(0);

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
    const orders = await this.prisma.shopifyOrder.findMany({
      where: {
        created_at: { gte: new Date(startDate), lte: new Date(endDate) },
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

  private async propagateToIncomes(orderId: number) {
    const incomes = await this.prisma.income.findMany({
      where: { shopify_order_id: orderId },
      select: { id: true, net_amount: true },
    });

    const cogsAgg = await this.prisma.shopifyLineItem.aggregate({
      where: { shopify_order_id: orderId },
      _sum: { total_cost: true },
    });

    const profitAgg = await this.prisma.shopifyLineItem.aggregate({
      where: { shopify_order_id: orderId },
      _sum: { gross_profit: true },
    });

    const cogsTotal = cogsAgg._sum.total_cost;
    const profitGross = profitAgg._sum.gross_profit;

    for (const income of incomes) {
      const cogsTotalNum = cogsTotal !== null ? Number(cogsTotal) : null;
      let calculatedProfit: number | null = null;
      if (cogsTotalNum !== null && income.net_amount !== null) {
        calculatedProfit = new Decimal(income.net_amount)
          .minus(new Decimal(cogsTotalNum))
          .toNumber();
      }

      const profitTotalNum =
        profitGross !== null && profitGross !== undefined
          ? Number(profitGross)
          : undefined;

      await this.prisma.income.update({
        where: { id: income.id },
        data: {
          cogs_total: cogsTotalNum,
          profit_gross:
            profitTotalNum !== undefined ? profitTotalNum : calculatedProfit,
        },
      });
    }
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
