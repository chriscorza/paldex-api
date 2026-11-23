import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PrismaService } from '../prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { CogsService } from '../cogs/cogs.service';
import { EmployeesService } from '../employees/employees.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { ExpensesService } from '../expenses/expenses.service';
import { FixedAssetsService } from '../fixed-assets/fixed-assets.service';
import { IncomesService } from '../incomes/incomes.service';
import { InventoryValuationService } from '../inventory/inventory-valuation.service';
import { MonthlyCloseService } from '../monthly-close/monthly-close.service';
import { PayablesService } from '../payables/payables.service';
import { PayrollService } from '../payroll/payroll.service';
import { ProductCostsService } from '../product-costs/product-costs.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { RecurringExpensesService } from '../recurring-expenses/recurring-expenses.service';
import { DailySalesService } from '../reports/daily-sales.service';
import { IncomeStatementService } from '../reports/income-statement.service';
import { ProfitEngine } from '../reports/profit-engine.service';
import { ReportsAggregationService } from '../reports/reports-aggregation.service';
import { SalesByEmployeeService } from '../reports/sales-by-employee.service';
import { TaxPaymentsService } from '../tax-payments/tax-payments.service';
import { TaxesService } from '../taxes/taxes.service';
import { McpToolkit, ToolCaller, ToolDef } from './toolkit';
import { McpServices } from './tools/services';
import { defineReportTools } from './tools/reports.tools';
import { defineExpenseTools } from './tools/expenses.tools';
import { defineIncomeTools } from './tools/incomes.tools';
import { defineDebtTools } from './tools/debts.tools';
import { defineTaxTools } from './tools/taxes.tools';
import { definePayrollTools } from './tools/payroll.tools';
import { defineAssetTools } from './tools/assets.tools';
import { defineConfigTools } from './tools/config.tools';

export type { ToolCaller } from './toolkit';

/*
 * El registro completo de tools. Cada dominio las declara en
 * `tools/<dominio>.tools.ts` con `McpToolkit.define`, que es lo único que
 * registra una tool: así ninguna se salta la autorización, la validación con el
 * DTO de REST ni la bitácora.
 *
 * Política (expand-mcp-agent): el agente puede leer y escribir en todos los
 * dominios salvo la lista negra estructural —usuarios, roles y permisos,
 * invitaciones, llaves MCP, la conexión de Shopify y sus credenciales, cerrar o
 * reabrir meses, y autenticación—. No hay import de esos servicios en este
 * módulo: aunque el rol tuviera esos permisos, no hay camino de código hacia
 * ellos. `mcp-tools.service.spec.ts` enumera cada tool y cada escritura.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly toolkit: McpToolkit,
    prisma: PrismaService,
    accounts: AccountsService,
    cogs: CogsService,
    employees: EmployeesService,
    expenseCategories: ExpenseCategoriesService,
    expenses: ExpensesService,
    fixedAssets: FixedAssetsService,
    incomes: IncomesService,
    inventoryValuation: InventoryValuationService,
    monthlyClose: MonthlyCloseService,
    payables: PayablesService,
    payroll: PayrollService,
    productCosts: ProductCostsService,
    receivables: ReceivablesService,
    recurringExpenses: RecurringExpensesService,
    dailySales: DailySalesService,
    incomeStatement: IncomeStatementService,
    profitEngine: ProfitEngine,
    aggregation: ReportsAggregationService,
    salesByEmployee: SalesByEmployeeService,
    taxPayments: TaxPaymentsService,
    taxes: TaxesService,
  ) {
    McpToolsService.defineAll(toolkit, {
      prisma,
      accounts,
      cogs,
      employees,
      expenseCategories,
      expenses,
      fixedAssets,
      incomes,
      inventoryValuation,
      monthlyClose,
      payables,
      payroll,
      productCosts,
      receivables,
      recurringExpenses,
      dailySales,
      incomeStatement,
      profitEngine,
      aggregation,
      salesByEmployee,
      taxPayments,
      taxes,
    });
  }

  /* Separado del constructor para que las pruebas armen el registro con dobles. */
  static defineAll(toolkit: McpToolkit, services: McpServices): void {
    if (toolkit.registry.length) return;
    defineReportTools(toolkit, services);
    defineExpenseTools(toolkit, services);
    defineIncomeTools(toolkit, services);
    defineDebtTools(toolkit, services);
    defineTaxTools(toolkit, services);
    definePayrollTools(toolkit, services);
    defineAssetTools(toolkit, services);
    defineConfigTools(toolkit, services);
  }

  get registry(): readonly ToolDef[] {
    return this.toolkit.registry;
  }

  buildServer(callerOrUserId: number | ToolCaller): McpServer {
    const caller: ToolCaller =
      typeof callerOrUserId === 'number'
        ? { userId: callerOrUserId }
        : callerOrUserId;
    const server = new McpServer({ name: 'paldex-mcp', version: '2.0.0' });
    this.toolkit.register(server, caller);
    return server;
  }
}
