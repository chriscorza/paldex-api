import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { LineItemProjectionService } from './line-item-projection.service';
import { Prisma as PrismaClient } from '@prisma/client';

const Decimal = PrismaClient.Decimal;

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
    private projection: LineItemProjectionService,
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
    if (amount <= 0) {
      await this.removeFullyRefundedIncome(transaction);
      return;
    }

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
          /*
           * Los reportes de P&L suman `net_amount`, no `amount`: `net_sales`
           * sale de `SUM(income.net_amount)`. Los ingresos manuales lo rellenan
           * en `IncomesService.create` —sin desglose, neto = bruto = importe—,
           * pero aquí se crea con Prisma directo y ese cálculo se saltaba, así
           * que la columna quedaba en NULL y las ventas de Shopify no sumaban
           * en ningún reporte.
           *
           * Neto = bruto = importe cobrado, sin desglose. Es lo correcto: el
           * importe de la transacción ya viene con los descuentos aplicados, y
           * repartir el descuento del pedido entre varias transacciones —un
           * pago partido— sería inventarse una asignación.
           */
          gross_amount: amount,
          net_amount: amount,
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

      /*
       * El pedido ya se proyectó antes de que existiera este income, así que su
       * costo no llegó a colgarse de ningún lado. Ahora que el income existe,
       * se vuelve a repartir el costo del pedido entre los ingresos que tenga.
       */
      if (existingShopifyOrder?.id) {
        await this.projection.propagateToIncomes(existingShopifyOrder.id);
      }
    } catch (err: any) {
      if (err?.code === 'P2002') {
        /*
         * El ingreso ya existe: es una reimportación, no un duplicado. Antes se
         * salía sin tocar nada, así que ninguna corrección de importes llegaba
         * al histórico ya cargado —hubo que arreglar `net_amount` por migración
         * SQL justo por esto—. Ahora se refresca con lo que dice Shopify.
         *
         * `account_id` no se toca a propósito: lo decide el mapeo de gateways y
         * el usuario puede haberlo reasignado a mano.
         */
        await this.prisma.income.updateMany({
          where: { source: 'shopify', external_transaction_id: transactionId },
          data: {
            amount,
            gross_amount: amount,
            net_amount: amount,
            date: transactionDate,
            ...(existingShopifyOrder?.id
              ? { shopify_order_id: existingShopifyOrder.id }
              : {}),
          },
        });

        this.logger.debug(
          `Income for transaction ${transactionId} already existed, amounts refreshed`,
        );

        if (existingShopifyOrder?.id) {
          await this.projection.propagateToIncomes(existingShopifyOrder.id);
        }
        return;
      }
      throw err;
    }
  }

  /*
   * Un cobro que quedó reembolsado por completo llega aquí con importe cero.
   * Si una importación anterior le creó ingreso por el total —el reembolso era
   * previo y entonces sólo entraba por webhook— hay que borrarlo: reimportar no
   * lo tocaría, porque ya no se emite ninguna transacción con importe.
   *
   * El borrado arrastra sus filas de `CostOfGoodsSold` por la cascada del
   * modelo, y se vuelve a repartir el costo entre los ingresos que le queden al
   * pedido.
   */
  private async removeFullyRefundedIncome(transaction: any): Promise<void> {
    const transactionId = transaction?.id ? String(transaction.id) : null;
    if (!transactionId) return;

    const existing = await this.prisma.income.findFirst({
      where: { source: 'shopify', external_transaction_id: transactionId },
      select: { id: true, shopify_order_id: true },
    });

    if (!existing) return;

    await this.prisma.income.delete({ where: { id: existing.id } });
    this.logger.log(
      `Deleted income ${existing.id}: transaction ${transactionId} is fully refunded`,
    );

    if (existing.shopify_order_id) {
      await this.projection.propagateToIncomes(existing.shopify_order_id);
    }
  }

  async handleRefund(connectionId: number, payload: any): Promise<void> {
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

      /* Decimal y no resta de números: 598.94 - 100 da 498.94000000000005 en
         punto flotante, y el proyecto prohíbe expresamente hacer aritmética de
         dinero así. */
      const currentAmount = new Decimal(income.amount);
      const newAmount = currentAmount.minus(new Decimal(refundAmount));

      if (newAmount.lessThanOrEqualTo(0)) {
        await this.prisma.income.delete({
          where: { id: income.id },
        });
        this.logger.log(
          `Deleted income ${income.id} due to full refund of transaction ${parentId}`,
        );
      } else {
        /* Mismo motivo que al crear: si el neto no baja con el importe, el
           reembolso no se refleja en ningún reporte. */
        await this.prisma.income.update({
          where: { id: income.id },
          data: {
            amount: newAmount,
            gross_amount: newAmount,
            net_amount: newAmount,
          },
        });
        this.logger.log(
          `Reduced income ${income.id} from ${currentAmount.toString()} to ${newAmount.toString()} due to refund`,
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
