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

          const existing = await this.prisma.income.findFirst({
            where: {
              source: 'shopify',
              external_transaction_id: String(txn.id),
            },
            select: { id: true },
          });

          if (!existing) {
            this.logger.warn(
              `Discrepancy: transaction ${txn.id} for order ${order.legacyResourceId} missing`,
            );
            discrepancies++;

            try {
              await this.transactionSync.handleTransactionCreate(connectionId, {
                id: txn.id,
                kind: txn.kind,
                status: txn.status,
                amount: txn.amountSet?.shopMoney?.amount || '0',
                gateway: txn.gateway,
                processed_at: txn.processedAt,
                order_id: order.legacyResourceId,
              });
              this.logger.log(`Backfilled income for transaction ${txn.id}`);
            } catch (err) {
              this.logger.error(
                `Failed to backfill income for transaction ${txn.id}`,
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
}
