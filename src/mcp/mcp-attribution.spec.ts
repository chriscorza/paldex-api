import { Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpToolsService, ToolCaller } from './mcp-tools.service';
import { McpAuthorizationService } from './mcp-authorization.service';
import { ExpensesService } from '../expenses/expenses.service';
import { DailySalesService } from '../reports/daily-sales.service';
import { IncomeStatementService } from '../reports/income-statement.service';
import { PayrollService } from '../payroll/payroll.service';
import { SalesByEmployeeService } from '../reports/sales-by-employee.service';

/*
 * Atribución de escrituras, de punta a punta sin base de datos: protocolo MCP
 * real + McpToolsService real + ExpensesService REAL contra un Prisma falso en
 * memoria que sí aplica los `where` (así «la cuenta de B» de verdad no aparece
 * para A). Sólo se simula la autorización: el rol del agente resuelve `scope`.
 */
describe('MCP write attribution (fix-mcp-write-attribution)', () => {
  const AGENT = 9; // cuenta de servicio ai_agent
  const A = 1; // dueño real
  const B = 2; // otro dueño

  let expenses: any[];
  let payments: any[];
  let nextId: number;
  let scope: 'OWN' | 'ANY';
  let client: Client;
  let authService: { requireContext: jest.Mock };

  const employees = [
    { id: 100, user_id: A, pay_frequency: 'MONTHLY' },
    { id: 200, user_id: B, pay_frequency: 'MONTHLY' },
  ];

  const accounts = [
    { id: 10, user_id: A },
    { id: 20, user_id: B },
    { id: 90, user_id: AGENT },
  ];

  const matches = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' ? true : row[k] === v,
    );

  const prisma: any = {
    account: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(accounts.find((a) => matches(a, where)) ?? null),
      ),
    },
    tax: { count: jest.fn() },
    expenseCategory: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    expense: {
      create: jest.fn(({ data }) => {
        const row = { id: nextId++, ...data };
        expenses.push(row);
        return Promise.resolve({ ...row, taxes: [] });
      }),
      findMany: jest.fn(({ where }) =>
        Promise.resolve(expenses.filter((e) => matches(e, where))),
      ),
      count: jest.fn(({ where }) =>
        Promise.resolve(expenses.filter((e) => matches(e, where)).length),
      ),
    },
    employee: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(employees.find((e) => matches(e, where)) ?? null),
      ),
    },
    payrollPayment: {
      create: jest.fn(({ data }) => {
        const row = { id: nextId++, ...data };
        payments.push(row);
        return Promise.resolve({ ...row, employee: { name: 'x' } });
      }),
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          payments.filter(
            (p) =>
              !where.employee ||
              employees.find((e) => e.id === p.employee_id)?.user_id ===
                where.employee.user_id,
          ),
        ),
      ),
      count: jest.fn(() => Promise.resolve(payments.length)),
      findFirst: jest.fn(({ where }) => {
        const p = payments.find(
          (x) =>
            x.id === where.id &&
            (!where.employee?.user_id ||
              employees.find((e) => e.id === x.employee_id)?.user_id ===
                where.employee.user_id),
        );
        return Promise.resolve(
          p && {
            ...p,
            employee: employees.find((e) => e.id === p.employee_id),
          },
        );
      }),
      update: jest.fn(({ where, data }) => {
        const p = payments.find((x) => x.id === where.id);
        Object.assign(p, data);
        return Promise.resolve({ ...p, employee: { name: 'x' } });
      }),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  };

  async function connect(caller: ToolCaller) {
    const tools = new McpToolsService(
      new ExpensesService(prisma),
      {} as unknown as DailySalesService,
      {} as unknown as IncomeStatementService,
      {} as unknown as SalesByEmployeeService,
      new PayrollService(prisma),
      authService as unknown as McpAuthorizationService,
    );
    const server = tools.buildServer(caller);
    const [c, s] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 't', version: '1' });
    await Promise.all([server.connect(s), client.connect(c)]);
  }

  const expenseArgs = (account_id: number) => ({
    amount: 100,
    concept: 'Papelería',
    date: '2026-08-25',
    invoiced: false,
    account_id,
    category_id: 1,
  });

  beforeEach(() => {
    expenses = [];
    payments = [];
    nextId = 1;
    scope = 'OWN';
    authService = {
      // La autorización sale SIEMPRE del rol del agente (AGENT), nunca del dueño.
      requireContext: jest.fn((userId: number) =>
        Promise.resolve({ userId, scope }),
      ),
    };
    jest.clearAllMocks();
  });

  it('5.2 una llave ligada a A escribe filas con user_id = A, visibles en el listado OWN de A', async () => {
    await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

    const res = await client.callTool({
      name: 'expense_create',
      arguments: expenseArgs(10),
    });
    expect(res.isError).toBeFalsy();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].user_id).toBe(A);

    const list = await client.callTool({
      name: 'expenses_list',
      arguments: {},
    });
    const parsed = JSON.parse((list.content as any)[0].text);
    expect(parsed.total).toBe(1);
    // El REST del dueño (OWN, sin ownerUserId) ve exactamente esa fila.
    const where = prisma.expense.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe(A);
    // La autorización se resolvió con el id del AGENTE, no con el del dueño.
    expect(authService.requireContext).toHaveBeenCalledWith(
      AGENT,
      'expense:create',
    );
    expect(authService.requireContext).not.toHaveBeenCalledWith(
      A,
      expect.anything(),
    );
  });

  it('5.3 una llave sin owner_user_id se rechaza al escribir, nombrándola, y no crea nada', async () => {
    await connect({ userId: AGENT, keyId: 4, ownerUserId: null });

    const res = await client.callTool({
      name: 'expense_create',
      arguments: expenseArgs(90),
    });

    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/key 4.*owner_user_id/);
    expect(prisma.expense.create).not.toHaveBeenCalled();
    expect(expenses).toHaveLength(0);
  });

  it('5.3b una llave sin dueño sí puede leer (sólo se bloquea escribir)', async () => {
    await connect({ userId: AGENT, keyId: 4, ownerUserId: null });

    const res = await client.callTool({ name: 'expenses_list', arguments: {} });

    expect(res.isError).toBeFalsy();
  });

  it('5.4 una llave ligada a A no puede usar una cuenta de B (400), ni con scope ANY', async () => {
    for (const s of ['OWN', 'ANY'] as const) {
      scope = s;
      await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

      const res = await client.callTool({
        name: 'expense_create',
        arguments: expenseArgs(20),
      });

      expect(res.isError).toBe(true);
      expect((res.content as any)[0].text).toMatch(/Account with id 20/);
    }
    expect(expenses).toHaveLength(0);
  });

  it('5.5 con el rol reducido a OWN el agente sigue leyendo los datos del dueño y escribiendo', async () => {
    scope = 'OWN';
    expenses.push({ id: 100, user_id: A, concept: 'ya existía' });
    expenses.push({ id: 101, user_id: B, concept: 'de otro' });
    await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

    const list = await client.callTool({
      name: 'expenses_list',
      arguments: {},
    });
    const parsed = JSON.parse((list.content as any)[0].text);
    expect(parsed.data.map((e: any) => e.id)).toEqual([100]);

    const created = await client.callTool({
      name: 'expense_create',
      arguments: expenseArgs(10),
    });
    expect(created.isError).toBeFalsy();
  });

  it('una llave sin re-enlazar (dueño = el propio agente) se comporta como antes', async () => {
    scope = 'ANY';
    await connect({ userId: AGENT, keyId: 4, ownerUserId: AGENT });

    const res = await client.callTool({
      name: 'expense_create',
      arguments: expenseArgs(20), // ANY sin delegar: puede usar cuentas ajenas, como siempre
    });

    expect(res.isError).toBeFalsy();
    expect(expenses[0].user_id).toBe(AGENT);
  });

  it('5.6 REST/JWT (sin llave, sin ownerUserId): la atribución no cambia', async () => {
    await connect({ userId: A });

    await client.callTool({
      name: 'expense_create',
      arguments: expenseArgs(10),
    });

    expect(expenses[0].user_id).toBe(A);
  });

  it('ninguna tool de escritura acepta el dueño como argumento', async () => {
    await connect({ userId: AGENT, keyId: 4, ownerUserId: A });
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const props = Object.keys(
        (tool.inputSchema as { properties?: object }).properties ?? {},
      );
      expect(props).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/owner|on_behalf|user_id/),
        ]),
      );
    }
  });

  it('emite una línea de log estructurada por llamada con key, llamante, dueño y fila', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

    await client.callTool({
      name: 'expense_create',
      arguments: expenseArgs(10),
    });

    const line = JSON.parse(
      String(logSpy.mock.calls[logSpy.mock.calls.length - 1]?.[0]),
    );
    expect(line).toEqual({
      tool: 'expense_create',
      key_id: 4,
      caller_user_id: AGENT,
      owner_user_id: A,
      outcome: 'ok',
      row_id: expenses[0].id,
    });
    logSpy.mockRestore();
  });

  describe('payroll writes follow the key owner (4.3, 5.5)', () => {
    const payment = (employee_id: number) => ({
      employee_id,
      period_start: '2026-08-01',
      period_end: '2026-08-15',
      scheduled_pay_date: '2026-08-15',
      gross_amount: 1000,
      bonuses: 100,
    });

    it('a bonus for the owner’s employee is created', async () => {
      await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

      const res = await client.callTool({
        name: 'payroll_create',
        arguments: payment(100),
      });

      expect(res.isError).toBeFalsy();
      expect(payments).toHaveLength(1);
    });

    it('a bonus against another owner’s employee is refused, even under ANY scope', async () => {
      for (const s of ['OWN', 'ANY'] as const) {
        scope = s;
        await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

        const res = await client.callTool({
          name: 'payroll_create',
          arguments: payment(200),
        });

        expect(res.isError).toBe(true);
        expect((res.content as any)[0].text).toMatch(/Employee not found/);
      }
      expect(payments).toHaveLength(0);
    });

    it('a payment account from another owner is refused', async () => {
      await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

      const res = await client.callTool({
        name: 'payroll_create',
        arguments: { ...payment(100), account_id: 20 },
      });

      expect(res.isError).toBe(true);
      expect(payments).toHaveLength(0);
    });

    it('a key without owner cannot write payroll', async () => {
      await connect({ userId: AGENT, keyId: 4, ownerUserId: null });

      const res = await client.callTool({
        name: 'payroll_create',
        arguments: payment(100),
      });

      expect(res.isError).toBe(true);
      expect(payments).toHaveLength(0);
    });

    it('payroll_pay refuses another owner’s payment (404) and pays the owner’s', async () => {
      payments.push(
        { id: 500, employee_id: 200, status: 'PENDING', net_amount: 1 },
        { id: 501, employee_id: 100, status: 'PENDING', net_amount: 1 },
      );
      prisma.account.findUnique = jest.fn().mockResolvedValue({
        id: 10,
        is_active: true,
      });
      await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

      const foreign = await client.callTool({
        name: 'payroll_pay',
        arguments: { payment_id: 500, paid_at: '2026-08-15', account_id: 10 },
      });
      expect(foreign.isError).toBe(true);
      expect(payments[0].status).toBe('PENDING');

      const own = await client.callTool({
        name: 'payroll_pay',
        arguments: { payment_id: 501, paid_at: '2026-08-15', account_id: 10 },
      });
      expect(own.isError).toBeFalsy();
      expect(payments[1].status).toBe('PAID');
    });

    it('payroll_pay on an already PAID payment fails and records nothing new', async () => {
      payments.push({
        id: 502,
        employee_id: 100,
        status: 'PAID',
        net_amount: 1,
      });
      await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

      const res = await client.callTool({
        name: 'payroll_pay',
        arguments: { payment_id: 502, paid_at: '2026-08-16', account_id: 10 },
      });

      expect(res.isError).toBe(true);
      expect(prisma.payrollPayment.update).not.toHaveBeenCalled();
    });

    it('with the role reduced to OWN, payroll_list still reads the owner’s payments only', async () => {
      scope = 'OWN';
      payments.push(
        { id: 600, employee_id: 100, status: 'PENDING' },
        { id: 601, employee_id: 200, status: 'PENDING' },
      );
      await connect({ userId: AGENT, keyId: 4, ownerUserId: A });

      const res = await client.callTool({
        name: 'payroll_list',
        arguments: { start_date: '2026-08-01', end_date: '2026-08-31' },
      });

      const parsed = JSON.parse((res.content as any)[0].text);
      expect(parsed.data.map((p: any) => p.id)).toEqual([600]);
    });
  });
});
