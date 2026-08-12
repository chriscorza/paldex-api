import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { LineItemProjectionService } from './line-item-projection.service';

@Injectable()
export class ShopifyOrderSyncService {
  private readonly logger = new Logger(ShopifyOrderSyncService.name);

  constructor(
    private prisma: PrismaService,
    private graphql: ShopifyGraphQLService,
    private projection: LineItemProjectionService,
  ) {}

  async handleOrderCreate(
    connectionId: number,
    orderPayload: any,
  ): Promise<void> {
    await this.syncOrder(connectionId, orderPayload);
  }

  async handleOrderUpdate(
    connectionId: number,
    orderPayload: any,
  ): Promise<void> {
    await this.syncOrder(connectionId, orderPayload);
  }

  private async syncOrder(
    connectionId: number,
    orderPayload: any,
  ): Promise<void> {
    const externalId = orderPayload.admin_graphql_api_id;
    const orderNumber = orderPayload.order_number;

    if (!externalId || !orderNumber) {
      this.logger.warn(`Webhook payload missing order identifiers`);
      return;
    }

    const enrichedItems = await this.enrichLineItems(
      connectionId,
      orderPayload.line_items || [],
    );

    const itemsTotal = (orderPayload.line_items || []).reduce(
      (sum: number, li: any) =>
        sum + (parseFloat(li.price) || 0) * (li.quantity || 0),
      0,
    );

    const shopifyOrderTotal = parseFloat(orderPayload.total_price || 0);
    const discountTotal = parseFloat(orderPayload.total_discounts || 0);
    const taxTotal = parseFloat(orderPayload.total_tax || 0);

    try {
      await this.prisma.shopifyOrder.upsert({
        where: {
          shopify_connection_id_external_order_id: {
            shopify_connection_id: connectionId,
            external_order_id: externalId,
          },
        },
        create: {
          shopify_connection_id: connectionId,
          external_order_id: externalId,
          order_number: orderNumber,
          items_total: itemsTotal,
          shopify_order_total: shopifyOrderTotal,
          discount_total: discountTotal,
          tax_total: taxTotal,
          cost_total: 0,
          profit_total: 0,
          has_missing_cost_data: false,
          line_items: enrichedItems,
        },
        update: {
          order_number: orderNumber,
          items_total: itemsTotal,
          shopify_order_total: shopifyOrderTotal,
          discount_total: discountTotal,
          tax_total: taxTotal,
          line_items: enrichedItems,
        },
      });

      const dbOrder = await this.prisma.shopifyOrder.findUnique({
        where: {
          shopify_connection_id_external_order_id: {
            shopify_connection_id: connectionId,
            external_order_id: externalId,
          },
        },
        select: { id: true },
      });

      if (dbOrder) {
        await this.projection.projectOrder(dbOrder.id);

        const orphanIncomes = await this.prisma.income.findMany({
          where: {
            source: 'shopify',
            shopify_order_id: null,
            external_reference: { startsWith: `${externalId}` },
          },
          select: { id: true },
        });

        for (const inc of orphanIncomes) {
          await this.prisma.income.update({
            where: { id: inc.id },
            data: { shopify_order_id: dbOrder.id },
          });
        }
      }
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.warn(`Duplicate order ${externalId}, retrying upsert`);
        await this.syncOrder(connectionId, orderPayload);
        return;
      }
      this.logger.error(
        `Failed to sync order ${externalId} for connection ${connectionId}`,
        err,
      );
    }
  }

  private async enrichLineItems(
    connectionId: number,
    lineItems: any[],
  ): Promise<any[]> {
    const variantIds = lineItems
      .map((li: any) => li.variant_id)
      .filter((id: any) => id);

    if (variantIds.length === 0) return lineItems;

    let enrichedData: Map<string, any>;
    try {
      enrichedData = await this.fetchLineItemEnrichment(
        connectionId,
        variantIds,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to fetch enrichment data for connection ${connectionId}, proceeding without`,
      );
      enrichedData = new Map();
    }

    return lineItems.map((li: any) => {
      const enrichment = enrichedData.get(String(li.variant_id)) || {};

      return {
        id: li.id,
        product_id: li.product_id,
        variant_id: li.variant_id,
        sku: li.sku,
        title: li.title,
        variant_title: li.variant_title,
        name: li.name,
        quantity: li.quantity,
        price: li.price,
        discount_allocations: li.discount_allocations || [],
        tax_lines: li.tax_lines || [],
        product_type: enrichment.product_type || null,
        collections: enrichment.collections || null,
        tags: enrichment.tags || null,
        unit_cost: enrichment.unit_cost || null,
      };
    });
  }

  private async fetchLineItemEnrichment(
    connectionId: number,
    variantIds: string[],
  ): Promise<Map<string, any>> {
    const gidList = variantIds
      .map((id) => `"gid://shopify/ProductVariant/${id}"`)
      .join(', ');

    const query = `
      query getVariantData($variantIds: [ID!]!) {
        nodes(ids: $variantIds) {
          ... on ProductVariant {
            id
            inventoryItem {
              unitCost {
                amount
              }
            }
            product {
              productType
              collections(first: 1) {
                edges {
                  node { title }
                }
              }
              tags
            }
          }
        }
      }
    `;

    const data: any = await this.graphql.graphql(connectionId, query, {
      variantIds: variantIds.map((id) => `gid://shopify/ProductVariant/${id}`),
    });

    const map = new Map<string, any>();
    const nodes: any[] = data?.nodes || [];

    for (const node of nodes) {
      const variantGid = node.id;
      const numericId = variantGid.replace('gid://shopify/ProductVariant/', '');

      const unitCostAmount = node?.inventoryItem?.unitCost?.amount;

      const collections =
        node?.product?.collections?.edges?.map((e: any) => e?.node?.title) ||
        [];

      map.set(numericId, {
        product_type: node?.product?.productType || null,
        collections: collections.length > 0 ? collections : null,
        tags:
          node?.product?.tags && node.product.tags.length > 0
            ? node.product.tags
            : null,
        unit_cost: unitCostAmount ? parseFloat(unitCostAmount) : null,
      });
    }

    return map;
  }
}
