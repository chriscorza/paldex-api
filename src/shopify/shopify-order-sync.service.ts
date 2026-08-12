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
    const orderDate = this.parseOrderDate(orderPayload.created_at);
    const cancelledAt = this.parseOrderDate(orderPayload.cancelled_at) ?? null;
    /* El webhook REST manda el MoneyBag; el backfill ya lo trae desenvuelto. */
    const shippingTotal = parseFloat(
      orderPayload.total_shipping ??
        orderPayload.total_shipping_price_set?.shop_money?.amount ??
        0,
    );

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
          shipping_total: Number.isFinite(shippingTotal) ? shippingTotal : 0,
          cancelled_at: cancelledAt,
          cost_total: 0,
          profit_total: 0,
          has_missing_cost_data: false,
          line_items: enrichedItems,
          created_at: orderDate,
        },
        update: {
          order_number: orderNumber,
          items_total: itemsTotal,
          shopify_order_total: shopifyOrderTotal,
          discount_total: discountTotal,
          tax_total: taxTotal,
          shipping_total: Number.isFinite(shippingTotal) ? shippingTotal : 0,
          cancelled_at: cancelledAt,
          line_items: enrichedItems,
          created_at: orderDate,
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

        /*
         * Estos ingresos acaban de engancharse al pedido, después de que
         * `projectOrder` repartiera el costo, así que se reparte otra vez para
         * que también les toque.
         */
        if (orphanIncomes.length > 0) {
          await this.projection.propagateToIncomes(dbOrder.id);
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

  /*
   * `created_at` es la fecha del pedido en Shopify, no la de importación. Sin
   * ella el `@default(now())` del modelo fecha todo el histórico el día del
   * backfill, y como los reportes de rentabilidad y `recalculateCosts` filtran
   * por esa columna, el periodo real de las ventas queda vacío.
   *
   * Devuelve `undefined` —no `null`— cuando no viene o no es una fecha válida:
   * en `create` deja actuar al default y en `update` no toca la columna.
   */
  private parseOrderDate(raw: any): Date | undefined {
    if (!raw) return undefined;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private async enrichLineItems(
    connectionId: number,
    lineItems: any[],
  ): Promise<any[]> {
    /*
     * El backfill ya trae costo, tipo de producto y etiquetas dentro de la
     * operación bulk, así que aquí sólo queda preguntar por lo que falta: el
     * camino del webhook —que llega crudo del REST— y los productos sin
     * `productType`, únicos donde las colecciones deciden la categoría.
     *
     * Antes se preguntaba por todos los pedidos siempre: una llamada por pedido,
     * miles en una importación, y un throttle de Shopify dejaba ese pedido sin
     * costo y sin categoría con sólo un warn.
     */
    const pending = lineItems.filter(
      (li: any) =>
        li.variant_id &&
        (li.unit_cost === undefined ||
          (!li.product_type && li.collections === undefined)),
    );

    let enrichedData = new Map<string, any>();

    if (pending.length > 0) {
      const variantIds = pending.map((li: any) => String(li.variant_id));
      try {
        enrichedData = await this.fetchWithRetry(connectionId, variantIds);
      } catch {
        this.logger.warn(
          `Failed to fetch enrichment data for connection ${connectionId}, proceeding without`,
        );
      }
    }

    return lineItems.map((li: any) => {
      const enrichment = enrichedData.get(String(li.variant_id)) || {};

      /* Lo consultado gana, pero nunca borra lo que ya venía del bulk. */
      const pick = (key: string) => enrichment[key] ?? li[key] ?? null;

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
        vendor: li.vendor ?? null,
        discount_allocations: li.discount_allocations || [],
        tax_lines: li.tax_lines || [],
        product_type: pick('product_type'),
        collections: pick('collections'),
        tags: pick('tags'),
        unit_cost: pick('unit_cost'),
      };
    });
  }

  /*
   * Shopify responde THROTTLED cuando se le pide de más, y en una importación
   * grande eso llega en rachas. Sin reintento, cada respuesta así era un pedido
   * sin costo que sólo se podía arreglar reimportando entero.
   */
  private async fetchWithRetry(
    connectionId: number,
    variantIds: string[],
    attempts = 3,
  ): Promise<Map<string, any>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.fetchLineItemEnrichment(connectionId, variantIds);
      } catch (err: any) {
        const throttled = /throttl/i.test(String(err?.message));
        if (!throttled || attempt >= attempts) throw err;

        const waitMs = 2000 * attempt;
        this.logger.warn(
          `Throttled by Shopify on connection ${connectionId}, retrying in ${waitMs}ms (${attempt}/${attempts - 1})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
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
