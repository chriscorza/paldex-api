import { Module } from '@nestjs/common';
import {
  ShopifyConnectionController,
  ShopifyWebhookController,
} from './shopify-connection.controller';
import { ShopifyConnectionService } from './shopify-connection.service';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [ShopifyConnectionController, ShopifyWebhookController],
  providers: [ShopifyConnectionService],
  imports: [PrismaModule],
  exports: [ShopifyConnectionService],
})
export class ShopifyModule {}
