import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportsController } from './reports.controller';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ProfitEngine } from './profit-engine.service';
import { ShopifyProfitabilityService } from './shopify-profitability.service';
import { ComparisonService } from './comparison.service';
import { SalesByEmployeeService } from './sales-by-employee.service';
import { InventoryCostService } from './inventory-cost.service';
import { DailySalesService } from './daily-sales.service';
import { IncomeStatementService } from './income-statement.service';
import { IncomeStatementPdfService } from './income-statement-pdf.service';

@Module({
  imports: [PrismaModule, ShopifyModule, InventoryModule],
  controllers: [ReportsController],
  providers: [
    ReportsAggregationService,
    ProfitEngine,
    ShopifyProfitabilityService,
    ComparisonService,
    SalesByEmployeeService,
    InventoryCostService,
    DailySalesService,
    IncomeStatementService,
    IncomeStatementPdfService,
  ],
  exports: [
    ReportsAggregationService,
    ProfitEngine,
    ShopifyProfitabilityService,
    ComparisonService,
    SalesByEmployeeService,
    InventoryCostService,
    DailySalesService,
    IncomeStatementService,
  ],
})
export class ReportsModule {}
