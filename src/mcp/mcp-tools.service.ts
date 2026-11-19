import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ExpenseStatus,
  InvoiceStatus,
  ExpenseCategoryType,
} from '@prisma/client';
import { ExpensesService } from '../expenses/expenses.service';
import { FilterExpensesDto } from '../expenses/dto/filter-expenses.dto';
import { CreateExpenseDto } from '../expenses/dto/create-expense.dto';
import { DailySalesService } from '../reports/daily-sales.service';
import { DailySalesQueryDto } from '../reports/dto/daily-sales-query.dto';
import { SalesByEmployeeService } from '../reports/sales-by-employee.service';
import { SalesByEmployeeQueryDto } from '../reports/dto/sales-by-employee-query.dto';
import { McpAuthorizationService } from './mcp-authorization.service';
import { OwnershipContext } from '../common/ownership';

/*
 * Las dos identidades de una llamada. `userId` es quien llama (autoriza: su rol
 * y su scope). `ownerUserId` es de quién son los libros: viene de la llave y
 * jamás de los argumentos de una tool. `null` = llave sin dueño (se rechaza al
 * escribir); `undefined` = no hay llave (JWT de pruebas): se actúa como uno mismo.
 */
export interface ToolCaller {
  userId: number;
  keyId?: number;
  ownerUserId?: number | null;
}

/*
 * El registro completo de tools. Cada una espeja un endpoint REST y pide el
 * mismo permiso que él — la tabla está en src/mcp/CLAUDE.md.
 *
 * **De aquí en adelante las tools son de sólo lectura.** `expense_create` es la
 * única excepción y es heredada: no se agrega otra que escriba. Agregar una tool
 * exige actualizar también specs/mcp-server/spec.md y el test del registro en
 * mcp-tools.service.spec.ts, que es lo que mantiene cierta la lista negra
 * (nómina, impuestos, usuarios/roles, credenciales de Shopify) conforme crece
 * esto.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly dailySalesService: DailySalesService,
    private readonly salesByEmployeeService: SalesByEmployeeService,
    private readonly mcpAuthorizationService: McpAuthorizationService,
  ) {}

  private readonly logger = new Logger(McpToolsService.name);

  /*
   * Cada tool pasa por aquí: autoriza con el rol del LLAMANTE, arma el contexto
   * con el propietario efectivo de la llave, rechaza escribir sin dueño y emite
   * una línea de log estructurada por llamada (D4: sin tabla nueva).
   */
  private async run(
    caller: ToolCaller,
    tool: string,
    permission: string,
    isWrite: boolean,
    fn: (ctx: OwnershipContext) => Promise<unknown>,
  ) {
    const log = (outcome: string, row_id?: unknown) =>
      this.logger.log(
        JSON.stringify({
          tool,
          key_id: caller.keyId ?? null,
          caller_user_id: caller.userId,
          owner_user_id: caller.ownerUserId ?? null,
          outcome,
          row_id: row_id ?? null,
        }),
      );
    try {
      const base = await this.mcpAuthorizationService.requireContext(
        caller.userId,
        permission,
      );
      if (isWrite && caller.ownerUserId === null) {
        throw new ForbiddenException(
          `MCP key ${caller.keyId} has no owner_user_id; rebind it (PATCH /mcp-keys/${caller.keyId}) before writing`,
        );
      }
      const ctx: OwnershipContext =
        caller.ownerUserId == null
          ? base
          : { ...base, ownerUserId: caller.ownerUserId };
      const result = await fn(ctx);
      log('ok', (result as { id?: unknown } | null)?.id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      log(`error: ${error instanceof Error ? error.message : 'unknown'}`);
      throw error;
    }
  }

  buildServer(callerOrUserId: number | ToolCaller): McpServer {
    const caller: ToolCaller =
      typeof callerOrUserId === 'number'
        ? { userId: callerOrUserId }
        : callerOrUserId;
    const server = new McpServer({
      name: 'paldex-mcp',
      version: '1.0.0',
    });

    server.registerTool(
      'expenses_list',
      {
        title: 'List expenses',
        description:
          'Lists expenses visible to the caller. Read-only, mirrors GET /expenses.',
        inputSchema: {
          start_date: z.string().optional(),
          end_date: z.string().optional(),
          search: z.string().optional(),
          account_id: z.number().int().optional(),
          category_id: z.number().int().optional(),
          category_type: z.nativeEnum(ExpenseCategoryType).optional(),
          status: z.nativeEnum(ExpenseStatus).optional(),
          invoice_status: z.nativeEnum(InvoiceStatus).optional(),
          vendor: z.string().optional(),
          is_tax_deductible: z.boolean().optional(),
          sort_by: z
            .enum(['date', 'amount', 'concept', 'created_at', 'id', 'paid_at'])
            .optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().int().min(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args) =>
        this.run(caller, 'expenses_list', 'expense:read', false, (ctx) =>
          this.expensesService.findAll(ctx, args as FilterExpensesDto),
        ),
    );

    server.registerTool(
      'sales_daily',
      {
        title: 'Daily sales',
        description:
          'Sales broken down day by day over a date range: net and gross sales, ' +
          'discounts, fees, shipping charged and number of sales per day, plus ' +
          'totals for the range. Days with no sales are returned as zeros, never ' +
          "omitted. Days are the shop's local days, not UTC. Read-only, mirrors " +
          'GET /reports/sales-daily. Both dates are required — there is no ' +
          'default period, so resolve what the user meant (this month, last week) ' +
          'and pass explicit dates. Maximum range is 366 days.',
        inputSchema: {
          start_date: z
            .string()
            .describe('First day of the range, inclusive. Format YYYY-MM-DD.'),
          end_date: z
            .string()
            .describe('Last day of the range, inclusive. Format YYYY-MM-DD.'),
        },
      },
      async (args) =>
        this.run(caller, 'sales_daily', 'report:read', false, (ctx) =>
          this.dailySalesService.getDailySales(ctx, args as DailySalesQueryDto),
        ),
    );

    server.registerTool(
      'sales_by_employee',
      {
        title: 'Sales by employee',
        description:
          'Sales attributed to each employee over a date range, with cost of ' +
          'goods sold, gross profit and cost_data_coverage per person. ' +
          'Attribution is by weekday: each employee owns the weekdays in their ' +
          "sales_days, computed in the shop's time zone. Read-only, mirrors " +
          'GET /reports/sales-by-employee. Both dates are required — there is ' +
          'no default period, so resolve what the user meant and pass explicit ' +
          'dates. Pass employee_ids to ask about one person or compare a few; ' +
          'omit it for everyone. `totals` covers the rows returned and ' +
          '`period_totals` always covers the whole period, so a filtered answer ' +
          'still shows what share of sales it represents. Caveat worth ' +
          'repeating to the user when comparing people across a long range: ' +
          "there is no shift history, so the range is scored using today's " +
          'weekday assignment (returned as sales_days on each row), not ' +
          'whatever it was at the time.',
        inputSchema: {
          start_date: z
            .string()
            .describe('First day of the range, inclusive. Format YYYY-MM-DD.'),
          end_date: z
            .string()
            .describe('Last day of the range, inclusive. Format YYYY-MM-DD.'),
          employee_ids: z
            .array(z.number().int())
            .optional()
            .describe(
              'Omit for every employee. One id for one person, several to compare them.',
            ),
          include_unassigned: z
            .boolean()
            .optional()
            .describe(
              'Include the unassigned row (sales on days nobody owns) when filtering by employee. Always present when not filtering.',
            ),
        },
      },
      async (args) =>
        this.run(caller, 'sales_by_employee', 'report:read', false, (ctx) =>
          this.salesByEmployeeService.getSalesByEmployee(
            ctx,
            args as SalesByEmployeeQueryDto,
          ),
        ),
    );

    server.registerTool(
      'expense_create',
      {
        title: 'Create expense',
        description:
          "Creates a new expense in the books of the account the API key is bound to (owner_user_id), not the agent's own. There is no argument to choose the owner. Write, requires expense:create, mirrors POST /expenses.",
        inputSchema: {
          amount: z.number(),
          concept: z.string().min(1),
          date: z.string(),
          invoiced: z.boolean(),
          account_id: z.number().int(),
          category_id: z.number().int().optional(),
          vendor: z.string().optional(),
        },
      },
      async (args) =>
        this.run(caller, 'expense_create', 'expense:create', true, (ctx) =>
          this.expensesService.create(ctx, args as CreateExpenseDto),
        ),
    );

    return server;
  }
}
