import { Injectable, Logger } from '@nestjs/common';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';

/*
 * Consulta única del backfill.
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
          totalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          transactions {
            id
            kind
            status
            gateway
            processedAt
            amountSet { shopMoney { amount } }
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
                product { id }
                variant { id }
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
    const result = await this.graphql.bulkOperationRunQuery(
      connectionId,
      BULK_ORDERS_QUERY,
    );

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
      this.logger.error(
        `Failed to process bulk operation ${operationId}`,
        err,
      );
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
      total_price: this.money(raw.totalPriceSet),
      total_discounts: this.money(raw.totalDiscountsSet),
      total_tax: this.money(raw.totalTaxSet),
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

    return (raw?.transactions ?? [])
      .filter((txn: any) => {
        const kind = (txn?.kind || '').toLowerCase();
        const status = (txn?.status || '').toLowerCase();
        return (kind === 'sale' || kind === 'capture') && status === 'success';
      })
      .map((txn: any) => ({
        id: this.legacyId(txn.id),
        order_id: orderId,
        kind: txn.kind,
        status: txn.status,
        gateway: txn.gateway,
        amount: this.money(txn.amountSet),
        processed_at: txn.processedAt,
      }));
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
}
