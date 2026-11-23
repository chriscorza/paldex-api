import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CogsModule } from '../cogs/cogs.module';
import { EmployeesModule } from '../employees/employees.module';
import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { IncomesModule } from '../incomes/incomes.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MonthlyCloseModule } from '../monthly-close/monthly-close.module';
import { PayablesModule } from '../payables/payables.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ProductCostsModule } from '../product-costs/product-costs.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { RecurringExpensesModule } from '../recurring-expenses/recurring-expenses.module';
import { ReportsModule } from '../reports/reports.module';
import { TaxPaymentsModule } from '../tax-payments/tax-payments.module';
import { TaxesModule } from '../taxes/taxes.module';
import { McpController } from './mcp.controller';
import { McpActionsController } from './mcp-actions.controller';
import { McpToolsInfoController } from './mcp-tools-info.controller';
import { McpServiceAccountController } from './mcp-service-account.controller';
import { McpServiceAccountService } from './mcp-service-account.service';
import { McpKeysModule } from '../mcp-keys/mcp-keys.module';
import { McpAuthorizationService } from './mcp-authorization.service';
import { McpToolsService } from './mcp-tools.service';
import { McpToolkit } from './toolkit';

/*
 * Los módulos de dominio que se importan aquí son lo que las tools pueden
 * alcanzar. Usuarios, roles, invitaciones y Shopify no se importan a propósito.
 * McpKeysModule sí, pero sólo para el endpoint REST que crea la cuenta del
 * asistente (POST /mcp-keys/service-account, con JWT y permisos de admin):
 * ninguna tool lo usa, y la prueba del registro lo vigila.
 */
@Module({
  imports: [
    PrismaModule,
    PermissionsModule,
    AccountsModule,
    CogsModule,
    EmployeesModule,
    ExpenseCategoriesModule,
    ExpensesModule,
    FixedAssetsModule,
    IncomesModule,
    InventoryModule,
    MonthlyCloseModule,
    PayablesModule,
    PayrollModule,
    ProductCostsModule,
    ReceivablesModule,
    RecurringExpensesModule,
    ReportsModule,
    TaxPaymentsModule,
    TaxesModule,
    McpKeysModule,
  ],
  controllers: [
    McpController,
    McpActionsController,
    McpToolsInfoController,
    McpServiceAccountController,
  ],
  providers: [
    McpAuthorizationService,
    McpToolkit,
    McpToolsService,
    McpServiceAccountService,
  ],
})
export class McpModule {}
