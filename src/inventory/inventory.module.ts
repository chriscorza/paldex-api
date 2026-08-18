import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { InventoryController } from './inventory.controller';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryValuationService } from './inventory-valuation.service';

@Module({
  imports: [PrismaModule, ShopifyModule],
  controllers: [InventoryController],
  providers: [InventorySnapshotService, InventoryValuationService],
  exports: [InventorySnapshotService, InventoryValuationService],
})
export class InventoryModule {}
