import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ProfitEngine } from './profit-engine.service';
import { ShopifyProfitabilityService } from './shopify-profitability.service';
import { ComparisonService } from './comparison.service';
import { LineItemProjectionService } from '../shopify/line-item-projection.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsAggregationService, ProfitEngine, ShopifyProfitabilityService, ComparisonService, LineItemProjectionService],
  exports: [ReportsAggregationService, ProfitEngine, ShopifyProfitabilityService, ComparisonService],
})
export class ReportsModule {}
