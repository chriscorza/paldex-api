import { Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpToolsService, ToolCaller } from './mcp-tools.service';
import { McpAuthorizationService } from './mcp-authorization.service';
import { ExpensesService } from '../expenses/expenses.service';
import { DailySalesService } from '../reports/daily-sales.service';
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
  let nextId: number;
  let scope: 'OWN' | 'ANY';
  let client: Client;
  let authService: { requireContext: jest.Mock };

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
    $transaction: jest.fn((ops) => Promise.all(ops)),
  };

  async function connect(caller: ToolCaller) {
    const tools = new McpToolsService(
      new ExpensesService(prisma),
      {} as unknown as DailySalesService,
      {} as unknown as SalesByEmployeeService,
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
});
