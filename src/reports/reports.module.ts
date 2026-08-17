import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { ReportsController } from './reports.controller';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ProfitEngine } from './profit-engine.service';
import { ShopifyProfitabilityService } from './shopify-profitability.service';
import { ComparisonService } from './comparison.service';
import { SalesByEmployeeService } from './sales-by-employee.service';

@Module({
  imports: [PrismaModule, ShopifyModule],
  controllers: [ReportsController],
  providers: [
    ReportsAggregationService,
    ProfitEngine,
    ShopifyProfitabilityService,
    ComparisonService,
    SalesByEmployeeService,
  ],
  exports: [
    ReportsAggregationService,
    ProfitEngine,
    ShopifyProfitabilityService,
    ComparisonService,
    SalesByEmployeeService,
  ],
})
export class ReportsModule {}
