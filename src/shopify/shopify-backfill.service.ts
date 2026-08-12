import { Injectable, Logger } from '@nestjs/common';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';

@Injectable()
export class ShopifyBackfillService {
  private readonly logger = new Logger(ShopifyBackfillService.name);

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
      this.logger.log(
        `Registering webhooks for connection ${connectionId}`,
      );
      await this.graphql.registerWebhooks(
        connectionId,
        this.getDefaultTopics(),
        callbackUrl,
      );

      this.logger.log(
        `Starting backfill for connection ${connectionId}`,
      );
      await this.startBackfill(connectionId);
    } catch (err) {
      this.logger.error(
        `Failed to setup webhooks/backfill for connection ${connectionId}`,
        err,
      );
    }
  }

  async startBackfill(connectionId: number): Promise<void> {
    const query = `
      {
        orders(
          query: "*"
          sortKey: CREATED_AT
        ) {
          edges {
            node {
              id
              name
              total_price: totalPriceSet { shopMoney { amount } }
              total_discounts: totalDiscountsSet { shopMoney { amount } }
              total_tax: totalTaxSet { shopMoney { amount } }
              line_items: lineItems(first: 50) {
                edges {
                  node {
                    id
                    product { id }
                    variant { id sku }
                    name
                    title: name
                    variant_title: variantTitle
                    quantity
                    price: originalUnitPriceSet { shopMoney { amount } }
                    discountedPriceSet { shopMoney { amount } }
                    discountAllocations {
                      allocatedAmountSet { shopMoney { amount } }
                    }
                    taxLines(first: 10) {
                      rate
                      ratePercentage
                      title
                    }
                    vendor
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.graphql.bulkOperationRunQuery(
        connectionId,
        query,
      );
      this.logger.log(
        `Bulk operation started for connection ${connectionId}: ${result.bulkOperation.id}`,
      );
    } catch (err) {
      this.logger.error(
        `Bulk operation failed for connection ${connectionId}: ${err}`,
      );
    }
  }

  async triggerBackfillEndpoint(connectionId: number): Promise<{
    operationId: string;
    status: string;
  }> {
    const query = `
      {
        orders(
          query: "*"
          sortKey: CREATED_AT
        ) {
          edges {
            node {
              id
              name
              total_price: totalPriceSet { shopMoney { amount } }
              total_discounts: totalDiscountsSet { shopMoney { amount } }
              total_tax: totalTaxSet { shopMoney { amount } }
              line_items: lineItems(first: 50) {
                edges {
                  node {
                    id
                    product { id }
                    variant { id sku }
                    name
                    title: name
                    variant_title: variantTitle
                    quantity
                    price: originalUnitPriceSet { shopMoney { amount } }
                    discountedPriceSet { shopMoney { amount } }
                    discountAllocations {
                      allocatedAmountSet { shopMoney { amount } }
                    }
                    taxLines(first: 10) {
                      rate
                      ratePercentage
                      title
                    }
                    vendor
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql.bulkOperationRunQuery(
      connectionId,
      query,
    );

    return {
      operationId: result.bulkOperation.id,
      status: result.bulkOperation.status,
    };
  }

  async pollAndProcessBackfill(
    connectionId: number,
    operationId: string,
  ): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    try {
      const { status, url } = await this.graphql.pollBulkOperation(
        connectionId,
        operationId,
      );

      if (status !== 'COMPLETED' || !url) {
        this.logger.log(
          `Bulk operation ${operationId} status: ${status}`,
        );
        return { processed, errors };
      }

      const jsonl = await this.graphql.downloadBulkOperationResult(url);
      this.logger.log(
        `Downloaded bulk result: ${jsonl.length} bytes`,
      );

      const lines = jsonl.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const order = JSON.parse(line);
          const orderData = this.mapBulkOrderToPayload(order);

          if (orderData) {
            await this.orderSync.handleOrderCreate(
              connectionId,
              orderData,
            );
          }

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
            `Failed to process bulk line for connection ${connectionId}`,
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
   * Normaliza un pedido del JSONL de la Bulk Operation a la misma forma que
   * traen los webhooks, que es la que espera el resto de la sincronización.
   *
   * Los payloads de webhook de Shopify vienen con forma REST
   * (`admin_graphql_api_id`, `order_number`), pero GraphQL no tiene esos
   * campos: son `id` y `name`. Y `name` es el texto que se ve en el admin
   * ("#1001"), no un número, así que hay que extraerle los dígitos para
   * `ShopifyOrder.order_number`, que es un Int.
   */
  private mapBulkOrderToPayload(raw: any): any {
    if (!raw.id) return null;

    const orderNumber = parseInt(String(raw.name ?? '').replace(/\D/g, ''), 10);
    if (Number.isNaN(orderNumber)) return null;

    const lineItems = (raw.line_items || []).map((li: any) => ({
      id: li.id,
      product_id: li.product_id || li.product?.id,
      variant_id: li.variant_id || li.variant?.id,
      sku: li.sku || li.variant?.sku,
      title: li.title || li.name,
      variant_title: li.variant_title || li.variantTitle,
      name: li.name || li.title,
      quantity: li.quantity,
      price: li.price,
      discount_allocations: li.discountAllocations || li.discount_allocations,
      tax_lines: li.taxLines || li.tax_lines,
    }));

    return {
      admin_graphql_api_id: raw.id,
      order_number: orderNumber,
      total_price: raw.total_price || '0',
      total_discounts: raw.total_discounts || '0',
      total_tax: raw.total_tax || '0',
      line_items: lineItems,
    };
  }

  private extractTransactions(raw: any): any[] {
    return (raw.transactions || []).filter(
      (txn: any) => {
        const kind = (txn.kind || '').toLowerCase();
        const status = (txn.status || '').toLowerCase();
        return (kind === 'sale' || kind === 'capture') && status === 'success';
      },
    );
  }
}
