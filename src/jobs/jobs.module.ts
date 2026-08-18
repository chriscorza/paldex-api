import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { PayrollModule } from '../payroll/payroll.module';
import { RecurringExpensesModule } from '../recurring-expenses/recurring-expenses.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ScheduledJobsService } from './scheduled-jobs.service';

@Module({
  imports: [
    PrismaModule,
    PayrollModule,
    RecurringExpensesModule,
    ShopifyModule,
    InventoryModule,
  ],
  providers: [ScheduledJobsService],
})
export class JobsModule {}
