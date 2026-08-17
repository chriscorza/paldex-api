import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';

@Injectable()
export class ShopifyReconciliationService {
  private readonly logger = new Logger(ShopifyReconciliationService.name);

  constructor(
    private prisma: PrismaService,
    private graphql: ShopifyGraphQLService,
    private transactionSync: ShopifyTransactionSyncService,
  ) {}

  async reconcileAll(): Promise<{
    connections: number;
    discrepancies: number;
  }> {
    const activeConnections = await this.prisma.shopifyConnection.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, last_synced_at: true },
    });

    let totalDiscrepancies = 0;

    for (const conn of activeConnections) {
      try {
        const count = await this.reconcileConnection(conn.id);
        totalDiscrepancies += count;
        if (count === 0) {
          await this.prisma.shopifyConnection.update({
            where: { id: conn.id },
            data: { last_synced_at: new Date() },
          });
        }
      } catch (err) {
        this.logger.error(
          `Reconciliation failed for connection ${conn.id}`,
          err,
        );
      }
    }

    return {
      connections: activeConnections.length,
      discrepancies: totalDiscrepancies,
    };
  }

  private async reconcileConnection(connectionId: number): Promise<number> {
    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { last_synced_at: true },
    });

    if (!conn) return 0;

    const fromDate = conn.last_synced_at
      ? new Date(conn.last_synced_at.getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 48 * 60 * 60 * 1000);

    const fromDateIso = fromDate.toISOString();

    const paginatedQuery = `
      query getTransactions($query: String!, $first: Int!, $after: String) {
        orders(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              legacyResourceId
              updatedAt
              transactions {
                id
                kind
                status
                amountSet { shopMoney { amount } }
                gateway
                processedAt
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    let discrepancies = 0;
    let hasNextPage = true;
    let afterCursor: string | null = null;

    while (hasNextPage) {
      const data: any = await this.graphql.graphql(
        connectionId,
        paginatedQuery,
        {
          query: `updated_at:>=${fromDateIso}`,
          first: 50,
          after: afterCursor,
        },
      );

      const orders = data?.orders;
      if (!orders) break;

      for (const edge of orders.edges || []) {
        const order = edge.node;
        for (const txn of order.transactions || []) {
          const kind = (txn.kind || '').toLowerCase();
          const status = (txn.status || '').toLowerCase();

          if (kind !== 'sale' && kind !== 'capture') continue;
          if (status !== 'success') continue;

          /*
           * GraphQL devuelve el id como GID
           * —`gid://shopify/OrderTransaction/9907187646711`— y el webhook, que
           * habla REST, guarda el número pelado. Comparando el GID contra la
           * columna, *ningún* cobro ya registrado se reconocía: la
           * reconciliación los daba todos por perdidos y creaba un ingreso
           * duplicado por cada venta que revisaba. Se compara y se guarda
           * siempre en la forma numérica, la del webhook.
           */
          const transactionId = this.legacyId(txn.id);
          if (!transactionId) continue;

          const existing = await this.prisma.income.findFirst({
            where: {
              source: 'shopify',
              external_transaction_id: transactionId,
            },
            select: { id: true },
          });

          if (!existing) {
            this.logger.warn(
              `Discrepancy: transaction ${transactionId} for order ${order.legacyResourceId} missing`,
            );
            discrepancies++;

            try {
              await this.transactionSync.handleTransactionCreate(connectionId, {
                id: transactionId,
                kind: txn.kind,
                status: txn.status,
                amount: txn.amountSet?.shopMoney?.amount || '0',
                gateway: txn.gateway,
                processed_at: txn.processedAt,
                order_id: order.legacyResourceId,
              });
              this.logger.log(
                `Backfilled income for transaction ${transactionId}`,
              );
            } catch (err) {
              this.logger.error(
                `Failed to backfill income for transaction ${transactionId}`,
                err,
              );
            }
          }
        }
      }

      hasNextPage = orders.pageInfo?.hasNextPage || false;
      afterCursor = orders.pageInfo?.endCursor || null;
    }

    return discrepancies;
  }

  /*
   * `gid://shopify/OrderTransaction/123` → `123`, que es lo que guarda el
   * webhook. Acepta también el número ya pelado: si Shopify cambiara de forma,
   * más vale reconocerlo que descartar el cobro en silencio.
   */
  private legacyId(gid: unknown): string | null {
    if (!gid) return null;
    const match = /(?:^|\/)(\d+)(?:\?.*)?$/.exec(String(gid));
    return match ? match[1] : null;
  }
}
