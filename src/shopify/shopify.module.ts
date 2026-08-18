import { Module } from '@nestjs/common';
import {
  ShopifyConnectionController,
  ShopifyWebhookController,
} from './shopify-connection.controller';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';
import { ShopifyBackfillService } from './shopify-backfill.service';
import { ShopifyReconciliationService } from './shopify-reconciliation.service';
import { LineItemProjectionService } from './line-item-projection.service';
import { ShopifyInventorySyncService } from './shopify-inventory-sync.service';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [ShopifyConnectionController, ShopifyWebhookController],
  providers: [
    ShopifyConnectionService,
    ShopifyGraphQLService,
    ShopifyOrderSyncService,
    ShopifyTransactionSyncService,
    ShopifyBackfillService,
    ShopifyReconciliationService,
    LineItemProjectionService,
    ShopifyInventorySyncService,
  ],
  imports: [PrismaModule],
  exports: [
    ShopifyConnectionService,
    ShopifyGraphQLService,
    LineItemProjectionService,
    ShopifyReconciliationService,
    ShopifyInventorySyncService,
  ],
})
export class ShopifyModule {}
