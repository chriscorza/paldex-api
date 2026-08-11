import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ShopifyConnectionService } from './shopify-connection.service';

@Injectable()
export class ShopifyTransactionSyncService {
  private readonly logger = new Logger(ShopifyTransactionSyncService.name);

  /*
   * Ciclo de dependencias:
   *   ConnectionService -> BackfillService -> TransactionSyncService -> ConnectionService
   *
   * Este servicio sólo necesita de ConnectionService la resolución de cuenta
   * por gateway; el ciclo se rompe con forwardRef en este extremo, que es el
   * más liviano de los tres.
   */
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ShopifyConnectionService))
    private connectionService: ShopifyConnectionService,
  ) {}

  async handleTransactionCreate(
    connectionId: number,
    payload: any,
  ): Promise<void> {
    const transaction = payload;

    const kind = (transaction?.kind || '').toLowerCase();
    const status = (transaction?.status || '').toLowerCase();

    if (kind !== 'sale' && kind !== 'capture') return;
    if (status !== 'success') return;

    const amount = parseFloat(transaction?.amount || '0');
    if (amount <= 0) return;

    const gateway = transaction?.gateway || 'unknown';
    const transactionId = String(transaction?.id);
    const orderId = String(transaction?.order_id);
    const externalOrderGid = `gid://shopify/Order/${orderId}`;

    const accountId = await this.connectionService.resolveAccountForGateway(
      connectionId,
      gateway,
    );

    if (!accountId) {
      this.logger.error(
        `Cannot resolve account for connection ${connectionId}, gateway ${gateway}`,
      );
      return;
    }

    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { user_id: true },
    });
    const userId = conn?.user_id ?? 0;

    const concept = `Venta Shopify #${orderId}`;
    const externalReference = `order:${externalOrderGid}|gateway:${gateway}`;
    const transactionDate = transaction?.processed_at
      ? new Date(transaction.processed_at)
      : new Date();

    const existingShopifyOrder = await this.prisma.shopifyOrder.findFirst({
      where: {
        shopify_connection_id: connectionId,
        external_order_id: externalOrderGid,
      },
      select: { id: true },
    });

    try {
      await this.prisma.income.create({
        data: {
          amount,
          concept,
          date: transactionDate,
          invoiced: false,
          account_id: accountId,
          source: 'shopify',
          external_transaction_id: transactionId,
          external_reference: externalReference,
          shopify_order_id: existingShopifyOrder?.id ?? null,
          user_id: userId,
          income_type: 'SHOPIFY_ORDER',
          channel: gateway,
        },
      });

      this.logger.log(
        `Created income for transaction ${transactionId}, order ${externalOrderGid}`,
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.debug(
          `Duplicate transaction ${transactionId}, skipped`,
        );
        return;
      }
      throw err;
    }
  }

  async handleRefund(
    connectionId: number,
    payload: any,
  ): Promise<void> {
    const transactions: any[] = payload?.transactions || [];

    for (const txn of transactions) {
      if (txn?.kind !== 'refund') continue;

      const parentId = String(txn?.parent_id);
      const refundAmount = parseFloat(txn?.amount || '0');
      if (refundAmount <= 0) continue;

      const income = await this.prisma.income.findFirst({
        where: {
          source: 'shopify',
          external_transaction_id: parentId,
        },
        select: { id: true, amount: true, shopify_order_id: true },
      });

      if (!income) {
        this.logger.warn(
          `Refund for transaction ${parentId} but no matching income found — record for manual review`,
        );
        continue;
      }

      const currentAmount = Number(income.amount);
      const newAmount = currentAmount - refundAmount;

      if (newAmount <= 0) {
        await this.prisma.income.delete({
          where: { id: income.id },
        });
        this.logger.log(
          `Deleted income ${income.id} due to full refund of transaction ${parentId}`,
        );
      } else {
        await this.prisma.income.update({
          where: { id: income.id },
          data: { amount: newAmount },
        });
        this.logger.log(
          `Reduced income ${income.id} from ${currentAmount} to ${newAmount} due to refund`,
        );
      }

      if (income.shopify_order_id && payload?.order_id) {
        await this.adjustShopifyOrderForRefund(
          connectionId,
          income.shopify_order_id,
          payload,
        );
      }
    }
  }

  private async adjustShopifyOrderForRefund(
    connectionId: number,
    shopifyOrderId: number,
    refundPayload: any,
  ): Promise<void> {
    const order = await this.prisma.shopifyOrder.findUnique({
      where: { id: shopifyOrderId },
      select: { line_items: true },
    });

    if (!order) return;

    const refundLineItems: any[] = refundPayload?.refund_line_items || [];
    if (refundLineItems.length === 0) return;

    let lineItems: any[] = [];
    if (Array.isArray(order.line_items)) {
      lineItems = order.line_items;
    } else if (typeof order.line_items === 'string') {
      try {
        lineItems = JSON.parse(order.line_items);
      } catch {
        return;
      }
    }

    for (const rli of refundLineItems) {
      const lineItemId = String(rli?.line_item?.id);
      const refundedQty = parseInt(String(rli?.quantity || '0'), 10);
      if (!lineItemId || refundedQty <= 0) continue;

      const idx = lineItems.findIndex(
        (li: any) => String(li?.id) === lineItemId,
      );
      if (idx < 0) continue;

      const li = lineItems[idx];
      const originalQty = parseInt(String(li?.quantity || '1'), 10) || 1;
      const remainingQty = Math.max(0, originalQty - refundedQty);

      if (remainingQty <= 0) {
        lineItems.splice(idx, 1);
      } else {
        lineItems[idx] = {
          ...li,
          quantity: remainingQty,
        };
      }
    }

    await this.prisma.shopifyOrder.update({
      where: { id: shopifyOrderId },
      data: { line_items: lineItems },
    });
  }
}
