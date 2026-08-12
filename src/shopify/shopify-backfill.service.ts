import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';
import { Prisma as PrismaClient } from '@prisma/client';

const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;

/*
 * Consulta única del backfill.
 *
 * El costo, el tipo de producto y las etiquetas viajan aquí dentro —no son
 * conexiones, así que no cuentan para el límite de anidamiento— para que el
 * backfill no tenga que preguntar por cada pedido: eso era una llamada GraphQL
 * por pedido, sin reintentos, y un throttle de Shopify dejaba ese pedido sin
 * costo y sin categoría en silencio. Las colecciones sí son una conexión y no
 * caben; se siguen resolviendo en `enrichLineItems`, que ya sólo hace falta
 * para los productos sin `productType`.
 *
 * Restricciones de las Bulk Operations que condicionan su forma:
 *  - Máximo 5 conexiones y 2 niveles de anidamiento. Aquí hay 2: `orders` y
 *    `lineItems`.
 *  - Los argumentos `first`/`last` en conexiones se ignoran, así que no se ponen.
 *  - `transactions` y `taxLines` NO son conexiones (devuelven listas planas),
 *    por eso viajan dentro del objeto padre y no se extraen a líneas aparte.
 *
 * No se usan alias de GraphQL para imitar los nombres REST: los campos de
 * dinero son MoneyBag (`{ shopMoney: { amount } }`) y un alias sólo esconde ese
 * objeto detrás de un nombre que parece un string. La traducción a la forma de
 * webhook se hace entera en `mapBulkOrderToPayload`.
 */
const BULK_ORDERS_QUERY = `
  {
    orders(query: "*" sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          totalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          transactions {
            id
            kind
            status
            gateway
            test
            processedAt
            amountSet { shopMoney { amount } }
            parentTransaction { id }
          }
          lineItems {
            edges {
              node {
                id
                name
                title
                variantTitle
                sku
                quantity
                vendor
                product { id productType tags }
                variant { id inventoryItem { unitCost { amount } } }
                originalUnitPriceSet { shopMoney { amount } }
                discountAllocations {
                  allocatedAmountSet { shopMoney { amount } }
                }
                taxLines {
                  title
                  rate
                  priceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

@Injectable()
export class ShopifyBackfillService {
  private readonly logger = new Logger(ShopifyBackfillService.name);

  /* Una Bulk Operation grande tarda minutos: 5 s × 120 = 10 min de margen. */
  private readonly POLL_INTERVAL_MS = 5000;
  private readonly POLL_MAX_ATTEMPTS = 120;

  constructor(
    private graphql: ShopifyGraphQLService,
    private orderSync: ShopifyOrderSyncService,
    private transactionSync: ShopifyTransactionSyncService,
  ) {}

  getDefaultTopics(): string[] {
    return [
      'ORDERS_CREATE',
      'ORDERS_UPDATED',
      'ORDER_TRANSACTIONS_CREATE',
      'REFUNDS_CREATE',
    ];
  }

  async registerWebhooksAndBackfill(
    connectionId: number,
    callbackUrl: string,
  ): Promise<void> {
    try {
      this.logger.log(`Registering webhooks for connection ${connectionId}`);
      await this.graphql.registerWebhooks(
        connectionId,
        this.getDefaultTopics(),
        callbackUrl,
      );

      this.logger.log(`Starting backfill for connection ${connectionId}`);
      await this.startBackfill(connectionId);
    } catch (err) {
      this.logger.error(
        `Failed to setup webhooks/backfill for connection ${connectionId}`,
        err,
      );
    }
  }

  /*
   * Camino del alta de tienda. Quien llama ya es fire-and-forget (el callback
   * de OAuth no espera), así que aquí sí se puede esperar el procesamiento
   * completo y dejar el resultado en el log.
   */
  async startBackfill(connectionId: number): Promise<void> {
    try {
      const operationId = await this.launchBulkOperation(connectionId);
      await this.pollAndProcessBackfill(connectionId, operationId);
    } catch (err) {
      this.logger.error(
        `Bulk operation failed for connection ${connectionId}: ${err}`,
      );
    }
  }

  /*
   * Camino del botón «reimportar histórico». Devuelve en cuanto Shopify acepta
   * la operación —que puede tardar minutos en completarse— y sigue procesando
   * en segundo plano. La request HTTP no debe quedarse esperando el JSONL.
   */
  async triggerBackfillEndpoint(connectionId: number): Promise<{
    operationId: string;
    status: string;
  }> {
    const operationId = await this.launchBulkOperation(connectionId);

    void this.pollAndProcessBackfill(connectionId, operationId).catch((err) => {
      this.logger.error(
        `Background backfill failed for connection ${connectionId}`,
        err,
      );
    });

    return { operationId, status: 'RUNNING' };
  }

  private async launchBulkOperation(connectionId: number): Promise<string> {
    let result: { bulkOperation: { id: string; status: string } };

    try {
      result = await this.graphql.bulkOperationRunQuery(
        connectionId,
        BULK_ORDERS_QUERY,
      );
    } catch (err: any) {
      /*
       * Shopify sólo admite una Bulk Operation por tienda a la vez. Sin este
       * caso, pulsar el botón dos veces —o hacerlo mientras corre el backfill
       * del alta— devuelve un 500 genérico en vez de decir qué pasa.
       */
      if (/already in progress/i.test(String(err?.message))) {
        throw new ConflictException(
          'A bulk operation is already running for this shop',
        );
      }
      throw err;
    }

    const operationId = result.bulkOperation.id;
    this.logger.log(
      `Bulk operation started for connection ${connectionId}: ${operationId}`,
    );

    return operationId;
  }

  async pollAndProcessBackfill(
    connectionId: number,
    operationId: string,
  ): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    try {
      const url = await this.waitForBulkOperation(connectionId, operationId);
      if (!url) return { processed, errors };

      const jsonl = await this.graphql.downloadBulkOperationResult(url);
      this.logger.log(`Downloaded bulk result: ${jsonl.length} bytes`);

      const orders = this.parseBulkJsonl(jsonl);
      this.logger.log(`Bulk result contains ${orders.length} orders`);

      for (const { order, lineItems } of orders) {
        try {
          const orderData = this.mapBulkOrderToPayload(order, lineItems);

          if (orderData) {
            await this.orderSync.handleOrderCreate(connectionId, orderData);
          }

          /*
           * Las transacciones van después del pedido a propósito: el income
           * que crea cada una se cuelga del ShopifyOrder ya existente.
           */
          for (const txn of this.extractTransactions(order)) {
            await this.transactionSync.handleTransactionCreate(
              connectionId,
              txn,
            );
          }

          processed++;
        } catch (err: any) {
          errors++;
          this.logger.error(
            `Failed to process bulk order ${order?.id} for connection ${connectionId}`,
            err,
          );
        }
      }

      this.logger.log(
        `Bulk processing complete: ${processed} orders, ${errors} errors`,
      );
    } catch (err) {
      this.logger.error(`Failed to process bulk operation ${operationId}`, err);
    }

    return { processed, errors };
  }

  /*
   * Espera a que la operación termine y devuelve la URL del JSONL, o `null` si
   * terminó sin resultado utilizable. `pollBulkOperation` es una sola consulta,
   * así que el bucle vive aquí.
   */
  private async waitForBulkOperation(
    connectionId: number,
    operationId: string,
  ): Promise<string | null> {
    for (let attempt = 1; attempt <= this.POLL_MAX_ATTEMPTS; attempt++) {
      const { status, url } = await this.graphql.pollBulkOperation(
        connectionId,
        operationId,
      );

      if (status === 'CREATED' || status === 'RUNNING') {
        await this.sleep(this.POLL_INTERVAL_MS);
        continue;
      }

      if (status !== 'COMPLETED') {
        this.logger.error(
          `Bulk operation ${operationId} ended with status ${status}`,
        );
        return null;
      }

      /* COMPLETED sin url = la tienda no tiene pedidos. No es un error. */
      if (!url) {
        this.logger.log(
          `Bulk operation ${operationId} completed with no results`,
        );
        return null;
      }

      return url;
    }

    this.logger.error(
      `Bulk operation ${operationId} still running after ` +
        `${(this.POLL_MAX_ATTEMPTS * this.POLL_INTERVAL_MS) / 1000}s, giving up`,
    );
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /*
   * El JSONL de una Bulk Operation NO trae las conexiones anidadas dentro de su
   * padre: cada hijo sale en su propia línea con un `__parentId` que apunta al
   * padre. Es decir que un pedido con 3 artículos ocupa 4 líneas, y la línea del
   * pedido no tiene ningún campo `lineItems`.
   *
   * Por eso hace falta reensamblar antes de mapear. Shopify emite a los hijos
   * después del padre, pero no se asume: se agrupa en una pasada y se resuelve
   * al final.
   */
  private parseBulkJsonl(jsonl: string): { order: any; lineItems: any[] }[] {
    const orders: any[] = [];
    const childrenByParent = new Map<string, any[]>();

    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue;

      let node: any;
      try {
        node = JSON.parse(line);
      } catch {
        this.logger.warn(`Skipping malformed JSONL line in bulk result`);
        continue;
      }

      if (node.__parentId) {
        const siblings = childrenByParent.get(node.__parentId) ?? [];
        siblings.push(node);
        childrenByParent.set(node.__parentId, siblings);
      } else {
        orders.push(node);
      }
    }

    return orders.map((order) => ({
      order,
      lineItems: childrenByParent.get(order.id) ?? [],
    }));
  }

  /*
   * Normaliza un pedido del JSONL a la misma forma que traen los webhooks, que
   * es la que espera el resto de la sincronización.
   *
   * Tres traducciones, todas por la misma razón —los webhooks hablan REST y las
   * Bulk Operations hablan GraphQL:
   *  - `name` es el texto del admin ("#1001"), no el `order_number` numérico.
   *  - Los identificadores son GID; aguas abajo se esperan ids numéricos
   *    (`enrichLineItems` reconstruye el GID del variant a partir del número).
   *  - El dinero llega como MoneyBag, no como string.
   */
  private mapBulkOrderToPayload(raw: any, lineItemNodes: any[]): any {
    if (!raw?.id) return null;

    const orderNumber = parseInt(String(raw.name ?? '').replace(/\D/g, ''), 10);
    if (Number.isNaN(orderNumber)) return null;

    const lineItems = lineItemNodes.map((li: any) => ({
      id: this.legacyId(li.id),
      product_id: this.legacyId(li.product?.id),
      variant_id: this.legacyId(li.variant?.id),
      sku: li.sku ?? null,
      title: li.title ?? li.name,
      variant_title: li.variantTitle ?? null,
      name: li.name,
      quantity: li.quantity,
      price: this.money(li.originalUnitPriceSet),
      vendor: li.vendor ?? null,
      /*
       * Mismos nombres que usa `enrichLineItems`: si vienen de aquí, esa
       * consulta por pedido ya no hace falta.
       */
      product_type: li.product?.productType || null,
      tags: li.product?.tags?.length ? li.product.tags : null,
      unit_cost: this.optionalMoney(li.variant?.inventoryItem?.unitCost),
      discount_allocations: (li.discountAllocations ?? []).map((d: any) => ({
        amount: this.money(d.allocatedAmountSet),
      })),
      tax_lines: (li.taxLines ?? []).map((t: any) => ({
        title: t.title,
        rate: t.rate,
        price: this.money(t.priceSet),
      })),
    }));

    return {
      admin_graphql_api_id: raw.id,
      order_number: orderNumber,
      created_at: raw.createdAt ?? null,
      cancelled_at: raw.cancelledAt ?? null,
      total_price: this.money(raw.totalPriceSet),
      total_discounts: this.money(raw.totalDiscountsSet),
      total_tax: this.money(raw.totalTaxSet),
      total_shipping: this.money(raw.totalShippingPriceSet),
      line_items: lineItems,
    };
  }

  /*
   * `Income` tiene un único `[source, external_transaction_id]`, así que el id
   * que salga de aquí debe ser el mismo que mandaría el webhook para esa venta
   * —el numérico—. Con el GID, la misma venta entraría dos veces: una por el
   * backfill y otra por el webhook.
   */
  private extractTransactions(raw: any): any[] {
    const orderId = this.legacyId(raw?.id);

    const all = raw?.transactions ?? [];
    const isSuccessful = (txn: any) =>
      (txn?.status || '').toLowerCase() === 'success' && txn?.test !== true;

    /*
     * Los reembolsos sólo llegaban por webhook, así que lo devuelto antes de la
     * importación quedaba cobrado al 100 % para siempre.
     *
     * Se restan del cobro que los originó en vez de aplicarlos aparte:
     * `handleRefund` rebaja el importe del ingreso sin dejar constancia de que
     * ya lo hizo, así que reimportar lo restaría otra vez. Calculado así, el
     * resultado es el mismo se importe una vez o diez.
     */
    const refundedByParent = new Map<string, Decimal>();
    for (const txn of all) {
      if ((txn?.kind || '').toLowerCase() !== 'refund') continue;
      if (!isSuccessful(txn)) continue;
      const parentId = this.legacyId(txn.parentTransaction?.id);
      if (!parentId) continue;
      const previous = refundedByParent.get(parentId) ?? new Decimal(0);
      refundedByParent.set(
        parentId,
        previous.plus(new Decimal(this.money(txn.amountSet))),
      );
    }

    return (
      all
        .filter((txn: any) => {
          const kind = (txn?.kind || '').toLowerCase();
          /* Una pasarela en modo prueba entraría como venta real. */
          return (kind === 'sale' || kind === 'capture') && isSuccessful(txn);
        })
        .map((txn: any) => {
          const id = this.legacyId(txn.id);
          const charged = new Decimal(this.money(txn.amountSet));
          const refunded = (id && refundedByParent.get(id)) || new Decimal(0);

          return {
            id,
            order_id: orderId,
            kind: txn.kind,
            status: txn.status,
            gateway: txn.gateway,
            amount: charged.minus(refunded).toFixed(2),
            processed_at: txn.processedAt,
          };
        })
        /* Devuelto entero: no es un ingreso de cero, es que no hubo ingreso. */
        .filter((txn: any) => Number(txn.amount) > 0)
    );
  }

  /* "gid://shopify/Order/450789469" -> "450789469" */
  private legacyId(gid: any): string | null {
    if (!gid) return null;
    const match = /\/(\d+)(?:\?.*)?$/.exec(String(gid));
    return match ? match[1] : null;
  }

  private money(bag: any): string {
    return bag?.shopMoney?.amount ?? '0';
  }

  /* Como `money`, pero distingue «cero» de «Shopify no lo sabe». */
  private optionalMoney(bag: any): number | null {
    const amount = bag?.amount ?? bag?.shopMoney?.amount;
    if (amount === undefined || amount === null) return null;
    const value = Number(amount);
    return Number.isFinite(value) ? value : null;
  }
}
