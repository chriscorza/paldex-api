import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ForbiddenException } from '@nestjs/common';
import { McpToolsService, ToolCaller } from './mcp-tools.service';
import { McpAuthorizationService } from './mcp-authorization.service';
import { ExpensesService } from '../expenses/expenses.service';
import { DailySalesService } from '../reports/daily-sales.service';
import { SalesByEmployeeService } from '../reports/sales-by-employee.service';
import { PayrollService } from '../payroll/payroll.service';

/*
 * Exercises the real MCP protocol (tools/list, tools/call) end to end over an
 * in-memory transport pair — no HTTP, no DB. ExpensesService and
 * McpAuthorizationService are mocked; everything above that (McpServer, zod
 * validation, JSON-RPC framing) is real. See design.md decisions #4 and #5.
 */
describe('McpToolsService', () => {
  let expensesService: { findAll: jest.Mock; create: jest.Mock };
  let dailySalesService: { getDailySales: jest.Mock };
  let salesByEmployeeService: { getSalesByEmployee: jest.Mock };
  let payrollService: {
    findAll: jest.Mock;
    createManual: jest.Mock;
    pay: jest.Mock;
  };
  let authService: { requireContext: jest.Mock };
  let client: Client;

  async function connectClient(userId: number | ToolCaller = 1) {
    const toolsService = new McpToolsService(
      expensesService as unknown as ExpensesService,
      dailySalesService as unknown as DailySalesService,
      salesByEmployeeService as unknown as SalesByEmployeeService,
      payrollService as unknown as PayrollService,
      authService as unknown as McpAuthorizationService,
    );
    const server = toolsService.buildServer(userId);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  beforeEach(() => {
    expensesService = { findAll: jest.fn(), create: jest.fn() };
    dailySalesService = { getDailySales: jest.fn() };
    salesByEmployeeService = { getSalesByEmployee: jest.fn() };
    payrollService = {
      findAll: jest.fn(),
      createManual: jest.fn(),
      pay: jest.fn(),
    };
    authService = { requireContext: jest.fn() };
  });

  it('exposes exactly the registered tools — no other tool', async () => {
    await connectClient();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'expense_create',
      'expenses_list',
      'payroll_create',
      'payroll_list',
      'payroll_pay',
      'sales_by_employee',
      'sales_daily',
    ]);
  });

  /*
   * Política de escritura: sólo hay escrituras en dominios con política de agente
   * declarada (gastos y nómina). Este test enumera CADA tool de escritura: agregar
   * otra sin tocarlo rompe el build en vez de pasar en revisión.
   */
  it('enumerates every write tool explicitly: expenses and payroll only', async () => {
    await connectClient();

    const { tools } = await client.listTools();
    const writeTools = tools
      .map((t) => t.name)
      .filter((name) => /_(create|update|delete|upsert|pay|sync)$/.test(name))
      .sort();

    expect(writeTools).toEqual([
      'expense_create',
      'payroll_create',
      'payroll_pay',
    ]);
  });

  /*
   * La lista negra es estructural: no hay tool —ni nombre ni argumento— que llegue
   * a impuestos de nómina, pagos de impuestos, cierre mensual, usuarios/roles,
   * invitaciones o credenciales de Shopify, aunque el rol tuviera esos permisos.
   */
  it('has no code path to the structural denylist', async () => {
    await connectClient();

    const { tools } = await client.listTools();
    const denied =
      /tax|close|role|user|invit|permission|shopify|credential|token|recalculate|generate/i;

    for (const tool of tools) {
      expect(tool.name).not.toMatch(denied);
      for (const arg of Object.keys(
        (tool.inputSchema as { properties?: object }).properties ?? {},
      )) {
        // Filtros legítimos como `is_tax_deductible` sí existen; lo vedado es la entrada a impuestos de nómina, roles, invitaciones y credenciales.
        expect(arg).not.toMatch(
          /tax_payment|payroll_tax|^role|invit|credential|token|shopify/i,
        );
      }
    }
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('payroll_generate');
    expect(names.filter((n) => /payroll/.test(n)).sort()).toEqual([
      'payroll_create',
      'payroll_list',
      'payroll_pay',
    ]);
  });

  it('expenses_list checks expense:read and delegates to ExpensesService.findAll', async () => {
    authService.requireContext.mockResolvedValue({
      userId: 1,
      scope: 'OWN',
    });
    expensesService.findAll.mockResolvedValue({
      data: [{ id: 1, concept: 'Renta' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    await connectClient(1);

    const result = await client.callTool({
      name: 'expenses_list',
      arguments: { status: 'PAID' },
    });

    expect(authService.requireContext).toHaveBeenCalledWith(1, 'expense:read');
    expect(expensesService.findAll).toHaveBeenCalledWith(
      { userId: 1, scope: 'OWN' },
      expect.objectContaining({ status: 'PAID' }),
    );
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual(expect.objectContaining({ total: 1 }));
  });

  it('expense_create checks expense:create, persists, and the row is visible via expenses_list afterward', async () => {
    authService.requireContext.mockResolvedValue({
      userId: 1,
      scope: 'OWN',
    });
    const created = { id: 42, concept: 'Papelería', amount: 100 };
    expensesService.create.mockResolvedValue(created);
    expensesService.findAll.mockResolvedValue({
      data: [created],
      total: 1,
      page: 1,
      limit: 20,
    });
    await connectClient(1);

    const createResult = await client.callTool({
      name: 'expense_create',
      arguments: {
        amount: 100,
        concept: 'Papelería',
        date: '2026-08-25',
        invoiced: false,
        account_id: 1,
      },
    });
    expect(createResult.isError).toBeFalsy();
    expect(expensesService.create).toHaveBeenCalledWith(
      { userId: 1, scope: 'OWN' },
      expect.objectContaining({ concept: 'Papelería' }),
    );

    const listResult = await client.callTool({
      name: 'expenses_list',
      arguments: {},
    });
    const text = (listResult.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text).data).toContainEqual(created);
  });

  it('never attributes expense_create to anyone but the caller, even if a broader scope were resolved', async () => {
    authService.requireContext.mockResolvedValue({
      userId: 9,
      scope: 'ANY',
    });
    expensesService.create.mockResolvedValue({ id: 1 });
    await connectClient(9);

    await client.callTool({
      name: 'expense_create',
      arguments: {
        amount: 1,
        concept: 'x',
        date: '2026-08-25',
        invoiced: false,
        account_id: 1,
      },
    });

    expect(expensesService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 9 }),
      expect.anything(),
    );
  });

  describe('sales_daily', () => {
    const report = {
      start_date: '2026-08-01T06:00:00.000Z',
      end_date: '2026-08-03T05:59:59.999Z',
      time_zone: 'America/Mexico_City',
      days: [
        { date: '2026-08-01', net_sales: 100, sales_count: 1 },
        { date: '2026-08-02', net_sales: 0, sales_count: 0 },
        { date: '2026-08-03', net_sales: 50, sales_count: 1 },
      ],
      totals: { net_sales: 150, sales_count: 2, days: 3, days_with_sales: 2 },
    };

    it('checks report:read and delegates to DailySalesService', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      dailySalesService.getDailySales.mockResolvedValue(report);
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_daily',
        arguments: { start_date: '2026-08-01', end_date: '2026-08-03' },
      });

      expect(authService.requireContext).toHaveBeenCalledWith(1, 'report:read');
      expect(dailySalesService.getDailySales).toHaveBeenCalledWith(
        { userId: 1, scope: 'OWN' },
        expect.objectContaining({
          start_date: '2026-08-01',
          end_date: '2026-08-03',
        }),
      );
      expect(result.isError).toBeFalsy();

      const text = (result.content as Array<{ text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.days).toHaveLength(3);
      expect(parsed.totals.net_sales).toBe(150);
    });

    it('keeps the zero day in the series it hands back', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      dailySalesService.getDailySales.mockResolvedValue(report);
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_daily',
        arguments: { start_date: '2026-08-01', end_date: '2026-08-03' },
      });

      const parsed = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text,
      );
      expect(parsed.days[1]).toMatchObject({
        date: '2026-08-02',
        sales_count: 0,
      });
    });

    /*
     * Sin rango no hay periodo por defecto: quien pregunta es el único que sabe
     * qué quiso decir el usuario con «este mes».
     */
    it('requires an explicit range instead of defaulting to a period', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_daily',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(dailySalesService.getDailySales).not.toHaveBeenCalled();
    });

    it('refuses a caller without report:read', async () => {
      authService.requireContext.mockRejectedValue(
        new ForbiddenException('Missing permission: report:read'),
      );
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_daily',
        arguments: { start_date: '2026-08-01', end_date: '2026-08-03' },
      });

      expect(result.isError).toBe(true);
      expect(dailySalesService.getDailySales).not.toHaveBeenCalled();
    });
  });

  describe('sales_by_employee', () => {
    const report = {
      period: { year: 2026, month: 8 },
      rows: [
        {
          employee_id: 1,
          employee_name: 'Luis',
          active: true,
          net_sales: 1000,
        },
      ],
      totals: { net_sales: 1000, sales_count: 1 },
      period_totals: { net_sales: 1400, sales_count: 2 },
    };

    it('checks report:read and delegates to SalesByEmployeeService', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      salesByEmployeeService.getSalesByEmployee.mockResolvedValue(report);
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_by_employee',
        arguments: { start_date: '2026-08-01', end_date: '2026-08-31' },
      });

      expect(authService.requireContext).toHaveBeenCalledWith(1, 'report:read');
      expect(salesByEmployeeService.getSalesByEmployee).toHaveBeenCalledWith(
        { userId: 1, scope: 'OWN' },
        expect.objectContaining({
          start_date: '2026-08-01',
          end_date: '2026-08-31',
        }),
      );
      expect(result.isError).toBeFalsy();
    });

    it('passes employee_ids through', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      salesByEmployeeService.getSalesByEmployee.mockResolvedValue(report);
      await connectClient(1);

      await client.callTool({
        name: 'sales_by_employee',
        arguments: {
          start_date: '2026-08-01',
          end_date: '2026-08-31',
          employee_ids: [1, 2],
        },
      });

      expect(salesByEmployeeService.getSalesByEmployee).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ employee_ids: [1, 2] }),
      );
    });

    /*
     * `period_totals` es lo que deja interpretar una respuesta filtrada: sin él,
     * «Luis: 1000» no dice si es casi todo el periodo o una migaja.
     */
    it('hands back both totals blocks', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      salesByEmployeeService.getSalesByEmployee.mockResolvedValue(report);
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_by_employee',
        arguments: {
          start_date: '2026-08-01',
          end_date: '2026-08-31',
          employee_ids: [1],
        },
      });

      const parsed = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text,
      );
      expect(parsed.totals.net_sales).toBe(1000);
      expect(parsed.period_totals.net_sales).toBe(1400);
    });

    it('requires an explicit range instead of defaulting to a period', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_by_employee',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(salesByEmployeeService.getSalesByEmployee).not.toHaveBeenCalled();
    });

    it('refuses a caller without report:read', async () => {
      authService.requireContext.mockRejectedValue(
        new ForbiddenException('Missing permission: report:read'),
      );
      await connectClient(1);

      const result = await client.callTool({
        name: 'sales_by_employee',
        arguments: { start_date: '2026-08-01', end_date: '2026-08-31' },
      });

      expect(result.isError).toBe(true);
      expect(salesByEmployeeService.getSalesByEmployee).not.toHaveBeenCalled();
    });
  });

  describe('payroll tools', () => {
    const listArgs = { start_date: '2026-08-01', end_date: '2026-08-31' };
    const createArgs = {
      employee_id: 3,
      period_start: '2026-08-01',
      period_end: '2026-08-15',
      scheduled_pay_date: '2026-08-15',
      gross_amount: 1000,
      bonuses: 200,
    };
    const payArgs = { payment_id: 5, paid_at: '2026-08-15', account_id: 2 };

    const cases: Array<[string, string, Record<string, unknown>]> = [
      ['payroll_list', 'payroll:read', listArgs],
      ['payroll_create', 'payroll:create', createArgs],
      ['payroll_pay', 'payroll:update', payArgs],
    ];

    it.each(cases)(
      '%s requires %s and returns nothing without it',
      async (name, permission, args) => {
        authService.requireContext.mockRejectedValue(
          new ForbiddenException(`Missing permission: ${permission}`),
        );
        await connectClient(1);

        const result = await client.callTool({ name, arguments: args });

        expect(result.isError).toBe(true);
        expect(authService.requireContext).toHaveBeenCalledWith(1, permission);
        expect(payrollService.findAll).not.toHaveBeenCalled();
        expect(payrollService.createManual).not.toHaveBeenCalled();
        expect(payrollService.pay).not.toHaveBeenCalled();
      },
    );

    it('payroll_list output equals the service output for the same filters', async () => {
      const envelope = {
        data: [{ id: 5, net_amount: 1200, status: 'PENDING' }],
        total: 1,
        page: 1,
        limit: 50,
      };
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      payrollService.findAll.mockResolvedValue(envelope);
      await connectClient(1);

      const result = await client.callTool({
        name: 'payroll_list',
        arguments: { ...listArgs, status: 'PENDING', employee_id: 3 },
      });

      expect(payrollService.findAll).toHaveBeenCalledWith(
        { userId: 1, scope: 'OWN' },
        expect.objectContaining({
          start_date: '2026-08-01',
          end_date: '2026-08-31',
          status: 'PENDING',
          employee_id: 3,
        }),
      );
      expect(
        JSON.parse((result.content as Array<{ text: string }>)[0].text),
      ).toEqual(envelope);
    });

    it('payroll_list has no implicit period: explicit dates are required', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      await connectClient(1);

      const result = await client.callTool({
        name: 'payroll_list',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(payrollService.findAll).not.toHaveBeenCalled();
    });

    it('payroll_create delegates to PayrollService.createManual and returns the payment', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      payrollService.createManual.mockResolvedValue({
        id: 9,
        status: 'PENDING',
      });
      await connectClient(1);

      const result = await client.callTool({
        name: 'payroll_create',
        arguments: createArgs,
      });

      expect(result.isError).toBeFalsy();
      expect(payrollService.createManual).toHaveBeenCalledWith(
        { userId: 1, scope: 'OWN' },
        expect.objectContaining({ employee_id: 3, bonuses: 200 }),
      );
    });

    it('payroll_create cannot create a PAID payment in one call (no status argument)', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      await connectClient(1);
      const { tools } = await client.listTools();
      const create = tools.find((t) => t.name === 'payroll_create')!;

      expect(
        Object.keys((create.inputSchema as { properties: object }).properties),
      ).not.toContain('status');
    });

    it('payroll_create refuses an employee outside the ownership target', async () => {
      authService.requireContext.mockResolvedValue({ userId: 9, scope: 'ANY' });
      payrollService.createManual.mockRejectedValue(
        new Error('Employee not found'),
      );
      await connectClient({ userId: 9, keyId: 4, ownerUserId: 1 });

      const result = await client.callTool({
        name: 'payroll_create',
        arguments: { ...createArgs, employee_id: 99 },
      });

      expect(result.isError).toBe(true);
      // El servicio recibe el contexto con el propietario efectivo de la llave.
      expect(payrollService.createManual).toHaveBeenCalledWith(
        { userId: 9, scope: 'ANY', ownerUserId: 1 },
        expect.anything(),
      );
    });

    it.each([
      ['paid_at', { payment_id: 5, account_id: 2 }],
      ['account_id', { payment_id: 5, paid_at: '2026-08-15' }],
    ])(
      'payroll_pay without %s fails instead of defaulting',
      async (_n, args) => {
        authService.requireContext.mockResolvedValue({
          userId: 1,
          scope: 'OWN',
        });
        await connectClient(1);

        const result = await client.callTool({
          name: 'payroll_pay',
          arguments: args,
        });

        expect(result.isError).toBe(true);
        expect(payrollService.pay).not.toHaveBeenCalled();
      },
    );

    it('payroll_pay passes id, paid_at, account_id and the caller context to the service', async () => {
      authService.requireContext.mockResolvedValue({ userId: 9, scope: 'OWN' });
      payrollService.pay.mockResolvedValue({ id: 5, status: 'PAID' });
      await connectClient({ userId: 9, keyId: 4, ownerUserId: 1 });

      const result = await client.callTool({
        name: 'payroll_pay',
        arguments: payArgs,
      });

      expect(result.isError).toBeFalsy();
      expect(authService.requireContext).toHaveBeenCalledWith(
        9,
        'payroll:update',
      );
      expect(payrollService.pay).toHaveBeenCalledWith(
        { userId: 9, scope: 'OWN', ownerUserId: 1 },
        5,
        { paid_at: '2026-08-15', account_id: 2 },
      );
    });

    it('rejects malformed dates before reaching the service', async () => {
      authService.requireContext.mockResolvedValue({ userId: 1, scope: 'OWN' });
      await connectClient(1);

      const result = await client.callTool({
        name: 'payroll_pay',
        arguments: { ...payArgs, paid_at: 'ayer' },
      });

      expect(result.isError).toBe(true);
      expect(payrollService.pay).not.toHaveBeenCalled();
    });
  });

  it('returns a tool error, not data, when the caller lacks the permission', async () => {
    authService.requireContext.mockRejectedValue(
      new ForbiddenException('Missing permission: expense:read'),
    );
    await connectClient(1);

    const result = await client.callTool({
      name: 'expenses_list',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(expensesService.findAll).not.toHaveBeenCalled();
  });
});
