import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { ShopifyReportQueryDto } from './dto/shopify-report-query.dto';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;

@Injectable()
export class ShopifyProfitabilityService {
  constructor(private prisma: PrismaService) {}

  async getCategoryProfitability(
    ctx: OwnershipContext,
    query: ShopifyReportQueryDto,
  ) {
    const startDate = new Date(query.start_date);
    const endDate = new Date(query.end_date);

    if (startDate >= endDate)
      throw new Error('start_date must be before end_date');

    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const lines = await this.prisma.shopifyLineItem.findMany({
      where: {
        shopify_order: {
          created_at: { gte: startDate, lte: endDate },
          ...(ownerFilter.user_id
            ? { shopify_connection: { user_id: ownerFilter.user_id } }
            : {}),
        },
      },
      select: {
        category_name: true,
        category_source: true,
        quantity: true,
        gross_sales: true,
        discount_allocated: true,
        net_sales: true,
        total_cost: true,
        gross_profit: true,
        profit_margin: true,
        unit_cost: true,
        shopify_order_id: true,
        title: true,
      },
    });

    const categoryMap = new Map<
      string,
      {
        category_name: string | null;
        category_source: string;
        units_sold: number;
        gross_sales: number;
        discounts: number;
        net_sales: number;
        cogs: number;
        gross_profit: number;
        orderIds: Set<number>;
        missing_cost_items: number;
        total_items: number;
      }
    >();

    for (const line of lines) {
      const key = line.category_name ?? '__UNKNOWN__';
      let cat = categoryMap.get(key);
      if (!cat) {
        cat = {
          category_name: line.category_name,
          category_source: line.category_source,
          units_sold: 0,
          gross_sales: 0,
          discounts: 0,
          net_sales: 0,
          cogs: 0,
          gross_profit: 0,
          orderIds: new Set(),
          missing_cost_items: 0,
          total_items: 0,
        };
        categoryMap.set(key, cat);
      }

      cat.units_sold += line.quantity;
      cat.gross_sales += Number(line.gross_sales);
      cat.discounts += Number(line.discount_allocated);
      cat.net_sales += Number(line.net_sales);
      cat.cogs += line.total_cost ? Number(line.total_cost) : 0;
      cat.gross_profit += line.gross_profit ? Number(line.gross_profit) : 0;
      cat.orderIds.add(line.shopify_order_id);
      cat.total_items++;
      if (line.unit_cost === null) cat.missing_cost_items++;
    }

    const totalGrossProfit = Array.from(categoryMap.values()).reduce(
      (sum, c) => sum + c.gross_profit,
      0,
    );

    const categories = Array.from(categoryMap.values()).map((c) => ({
      category_name: c.category_name || 'Sin categoría',
      category_source: c.category_name ? c.category_source : 'UNKNOWN',
      units_sold: c.units_sold,
      order_count: c.orderIds.size,
      gross_sales: Math.round(c.gross_sales * 100) / 100,
      discounts: Math.round(c.discounts * 100) / 100,
      net_sales: Math.round(c.net_sales * 100) / 100,
      cogs: Math.round(c.cogs * 100) / 100,
      gross_profit: Math.round(c.gross_profit * 100) / 100,
      gross_margin_percentage:
        c.net_sales > 0
          ? Math.round((c.gross_profit / c.net_sales) * 100 * 100) / 100
          : null,
      profit_share_percentage:
        totalGrossProfit > 0
          ? Math.round((c.gross_profit / totalGrossProfit) * 100 * 100) / 100
          : null,
      missing_cost_items: c.missing_cost_items,
      incomplete_cost_data: c.missing_cost_items > 0,
    }));

    const sortBy = query.sort_by || 'gross_profit';
    const order = query.order || 'desc';

    categories.sort((a: any, b: any) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      const cmp = aVal - bVal;
      return order === 'desc' ? -cmp : cmp;
    });

    const sortedByProfit = [...categories].sort(
      (a: any, b: any) => b.gross_profit - a.gross_profit,
    );
    const sortedByMargin = [...categories].sort((a: any, b: any) => {
      if (
        a.gross_margin_percentage === null &&
        b.gross_margin_percentage === null
      )
        return 0;
      if (a.gross_margin_percentage === null) return 1;
      if (b.gross_margin_percentage === null) return -1;
      return b.gross_margin_percentage - a.gross_margin_percentage;
    });

    const highlights = {
      top_by_gross_profit:
        sortedByProfit.length > 0 ? sortedByProfit[0].category_name : null,
      top_by_margin:
        sortedByMargin.length > 0 ? sortedByMargin[0].category_name : null,
      top_by_net_sales:
        categories.length > 0
          ? [...categories].sort((a, b) => b.net_sales - a.net_sales)[0]
              .category_name
          : null,
      categories_with_missing_costs: categories
        .filter((c) => c.incomplete_cost_data)
        .map((c) => c.category_name),
    };

    const totalItems = categories.reduce(
      (s, c) =>
        s +
        c.missing_cost_items +
        (c.missing_cost_items > 0 ? 0 : (c as any).total_items || 0),
      0,
    );
    const itemsWithCost =
      totalItems - categories.reduce((s, c) => s + c.missing_cost_items, 0);

    const costDataQuality = {
      total_line_items: totalItems,
      line_items_with_cost: itemsWithCost,
      missing_cost_items: totalItems - itemsWithCost,
      sales_without_cost: categories.reduce(
        (s, c) => (c.incomplete_cost_data ? s + c.net_sales : s),
        0,
      ),
      cost_data_coverage:
        totalItems > 0
          ? Math.round((itemsWithCost / totalItems) * 100 * 100) / 100
          : null,
      gross_profit_confirmed: categories
        .filter((c) => !c.incomplete_cost_data)
        .reduce((s, c) => s + c.gross_profit, 0),
      pending_cost_updates: false,
    };

    return { categories, highlights, cost_data_quality: costDataQuality };
  }

  async getProductProfitability(
    ctx: OwnershipContext,
    query: ShopifyReportQueryDto,
  ) {
    const startDate = new Date(query.start_date);
    const endDate = new Date(query.end_date);
    if (startDate >= endDate)
      throw new Error('start_date must be before end_date');

    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const productMap = new Map<string, any>();

    const lines = await this.prisma.shopifyLineItem.findMany({
      where: {
        shopify_order: {
          created_at: { gte: startDate, lte: endDate },
          ...(ownerFilter.user_id
            ? { shopify_connection: { user_id: ownerFilter.user_id } }
            : {}),
        },
        ...(query.category_name ? { category_name: query.category_name } : {}),
      },
      select: {
        sku: true,
        shopify_product_id: true,
        title: true,
        category_name: true,
        quantity: true,
        net_sales: true,
        total_cost: true,
        gross_profit: true,
        profit_margin: true,
      },
    });

    for (const line of lines) {
      const key = line.sku || line.shopify_product_id || line.title;
      let p = productMap.get(key);
      if (!p) {
        p = {
          sku: line.sku,
          product_id: line.shopify_product_id,
          title: line.title,
          category_name: line.category_name,
          units_sold: 0,
          net_sales: 0,
          cogs: 0,
          gross_profit: 0,
          items_with_cost: 0,
          total_items: 0,
        };
        productMap.set(key, p);
      }
      p.units_sold += line.quantity;
      p.net_sales += Number(line.net_sales);
      p.cogs += line.total_cost ? Number(line.total_cost) : 0;
      p.gross_profit += line.gross_profit ? Number(line.gross_profit) : 0;
      p.total_items++;
      if (line.total_cost !== null) p.items_with_cost++;
    }

    const products = Array.from(productMap.values()).map((p) => ({
      ...p,
      net_sales: Math.round(p.net_sales * 100) / 100,
      cogs: Math.round(p.cogs * 100) / 100,
      gross_profit: Math.round(p.gross_profit * 100) / 100,
      gross_margin_percentage:
        p.net_sales > 0
          ? Math.round((p.gross_profit / p.net_sales) * 100 * 100) / 100
          : null,
    }));

    const sortBy = query.sort_by || 'gross_profit';
    const order = query.order || 'desc';
    products.sort((a: any, b: any) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    });

    const page = query.page || 1;
    const limit = query.limit || 50;
    const start = (page - 1) * limit;
    const paged = products.slice(start, start + limit);

    return { data: paged, total: products.length, page, limit };
  }

  async getChannelProfitability(
    ctx: OwnershipContext,
    query: ShopifyReportQueryDto,
  ) {
    const startDate = new Date(query.start_date);
    const endDate = new Date(query.end_date);
    if (startDate >= endDate)
      throw new Error('start_date must be before end_date');

    const ownerFilter = buildOwnerFilter(ctx) as { user_id?: number };

    const incomes = await this.prisma.income.findMany({
      where: {
        ...ownerFilter,
        date: { gte: startDate, lte: endDate },
        shopify_order: { isNot: null },
      },
      select: {
        channel: true,
        net_amount: true,
        gross_amount: true,
        cogs_total: true,
        profit_gross: true,
        discount_total: true,
        fee_total: true,
      },
    });

    const channelMap = new Map<
      string,
      {
        channel: string | null;
        gross_sales: number;
        net_sales: number;
        cogs: number;
        gross_profit: number;
        fees: number;
        order_count: number;
      }
    >();

    for (const income of incomes) {
      const key = income.channel || 'Sin canal';
      let ch = channelMap.get(key);
      if (!ch) {
        ch = {
          channel: income.channel,
          gross_sales: 0,
          net_sales: 0,
          cogs: 0,
          gross_profit: 0,
          fees: 0,
          order_count: 0,
        };
        channelMap.set(key, ch);
      }
      ch.gross_sales += Number(income.gross_amount ?? income.net_amount ?? 0);
      ch.net_sales += Number(income.net_amount ?? 0);
      ch.cogs += Number(income.cogs_total ?? 0);
      ch.gross_profit += Number(income.profit_gross ?? 0);
      ch.fees += Number(income.fee_total ?? 0);
      ch.order_count++;
    }

    const channels = Array.from(channelMap.values()).map((c) => ({
      channel: c.channel ?? 'Sin canal',
      order_count: c.order_count,
      gross_sales: Math.round(c.gross_sales * 100) / 100,
      net_sales: Math.round(c.net_sales * 100) / 100,
      cogs: Math.round(c.cogs * 100) / 100,
      gross_profit: Math.round(c.gross_profit * 100) / 100,
      fees: Math.round(c.fees * 100) / 100,
      gross_margin_percentage:
        c.net_sales > 0
          ? Math.round((c.gross_profit / c.net_sales) * 100 * 100) / 100
          : null,
    }));

    return {
      channels,
      commission_data_available: channels.some((c) => c.fees > 0) ? true : null,
    };
  }
}
