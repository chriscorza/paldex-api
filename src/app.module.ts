import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { UserModule } from './user/user.module';
import { IncomesModule } from './incomes/incomes.module';
import { AccountsModule } from './accounts/accounts.module';
import { TaxesModule } from './taxes/taxes.module';
import { ExpensesModule } from './expenses/expenses.module';
import { PermissionsModule } from './permissions/permissions.module';
import { RolesModule } from './roles/roles.module';
import { ShopifyModule } from './shopify/shopify.module';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module';
import { CogsModule } from './cogs/cogs.module';
import { EmployeesModule } from './employees/employees.module';
import { PayrollModule } from './payroll/payroll.module';
import { TaxPaymentsModule } from './tax-payments/tax-payments.module';
import { ReportsModule } from './reports/reports.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProductCostsModule } from './product-costs/product-costs.module';
import { RecurringExpensesModule } from './recurring-expenses/recurring-expenses.module';
import { PayablesModule } from './payables/payables.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { MonthlyCloseModule } from './monthly-close/monthly-close.module';
import { InvitationsModule } from './invitations/invitations.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { DataSeedService } from './data-seed.service';
import { PrismaModule } from './prisma.module';
import { VersionModule } from './version/version.module';

@Module({
  imports: [
    PrismaModule,
    VersionModule,
    AuthModule,
    ConfigModule.forRoot({
      envFilePath: '.env.prod',
    }),
    UserModule,
    IncomesModule,
    AccountsModule,
    TaxesModule,
    ExpensesModule,
    PermissionsModule,
    RolesModule,
    ShopifyModule,
    ExpenseCategoriesModule,
    CogsModule,
    EmployeesModule,
    PayrollModule,
    TaxPaymentsModule,
    ReportsModule,
    InventoryModule,
    ProductCostsModule,
    RecurringExpensesModule,
    PayablesModule,
    ReceivablesModule,
    MonthlyCloseModule,
    InvitationsModule,
    /*
     * Réplica única: `ScheduleModule` corre los crons en cada proceso, así que
     * levantar una segunda instancia de la API duplicaría cada corrida. La
     * generación aguanta el duplicado —salta lo que ya existe— pero la
     * reconciliación llamaría a Shopify dos veces por hora sin necesidad.
     */
    ScheduleModule.forRoot(),
    JobsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AdminBootstrapService,
    DataSeedService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
