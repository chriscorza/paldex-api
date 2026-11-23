import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { connectTestClient } from './testing';
import { McpServices } from './tools/services';
import { ToolCaller } from './toolkit';

/*
 * El registro completo sobre el protocolo MCP real (tools/list, tools/call)
 * con servicios dobles. Ver openspec/changes/expand-mcp-agent.
 */

const READ_TOOLS = [
  'accounts_list',
  'cash_report',
  'cogs_list',
  'context_get',
  'employees_list',
  'expense_categories_list',
  'expense_get',
  'expenses_breakdown',
  'expenses_list',
  'fixed_assets_list',
  'income_get',
  'income_statement',
  'incomes_list',
  'inventory_valuation',
  'monthly_close_status',
  'monthly_report',
  'payable_get',
  'payables_list',
  'payroll_list',
  'product_costs_list',
  'product_costs_missing',
  'receivable_get',
  'receivables_list',
  'recurring_expenses_list',
  'sales_by_employee',
  'sales_daily',
  'sales_without_cost',
  'tax_payment_estimate',
  'tax_payments_list',
  'taxes_list',
];

/*
 * Cada tool de escritura, explícita: agregar una sin tocar esta lista rompe la
 * prueba en vez de pasar en revisión.
 */
const WRITE_TOOLS = [
  'account_create',
  'account_delete',
  'account_update',
  'cogs_create',
  'cogs_delete',
  'cogs_update',
  'employee_create',
  'employee_delete',
  'employee_update',
  'expense_categories_list_placeholder',
].filter((n) => !n.endsWith('_placeholder'));
WRITE_TOOLS.push(
  'expense_category_create',
  'expense_category_delete',
  'expense_category_update',
  'expense_create',
  'expense_delete',
  'expense_pay',
  'expense_update',
  'expenses_create_bulk',
  'fixed_asset_create',
  'fixed_asset_delete',
  'fixed_asset_dispose',
  'fixed_asset_update',
  'income_create',
  'income_delete',
  'income_update',
  'incomes_create_bulk',
  'payable_add_payment',
  'payable_create',
  'payable_delete',
  'payable_payment_delete',
  'payable_update',
  'payroll_create',
  'payroll_delete',
  'payroll_generate',
  'payroll_pay',
  'payroll_update',
  'product_cost_create',
  'product_cost_delete',
  'product_cost_update',
  'product_costs_bulk',
  'receivable_add_collection',
  'receivable_collection_delete',
  'receivable_create',
  'receivable_delete',
  'receivable_update',
  'recurring_expense_create',
  'recurring_expense_delete',
  'recurring_expense_update',
  'tax_create',
  'tax_delete',
  'tax_payment_create',
  'tax_payment_delete',
  'tax_payment_pay',
  'tax_payment_update',
  'tax_update',
);

/* Bitácora en memoria que respeta el índice único (owner, tool, client_ref). */
function fakeActions() {
  const rows: any[] = [];
  let id = 1;
  const api = {
    rows,
    create: jest.fn(({ data }) => {
      if (
        data.client_ref &&
        rows.some(
          (r) =>
            r.owner_user_id === data.owner_user_id &&
            r.tool === data.tool &&
            r.client_ref === data.client_ref,
        )
      ) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      }
      const row = {
        id: id++,
        entity_id: null,
        before: null,
        after: null,
        ...data,
      };
      rows.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return Promise.resolve(row);
    }),
    delete: jest.fn(({ where }) => {
      rows.splice(
        rows.findIndex((r) => r.id === where.id),
        1,
      );
      return Promise.resolve();
    }),
    findFirst: jest.fn(({ where }) =>
      Promise.resolve(
        rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
          null,
      ),
    ),
  };
  return api;
}

process.env.JWT_SECRET ??= 'test-secret';

describe('McpToolsService (expand-mcp-agent)', () => {
  let client: Client;
  let actions: ReturnType<typeof fakeActions>;
  let prisma: any;
  let services: Partial<McpServices>;
  let auth: { requireContext: jest.Mock };
  let closed: { year: number; month: number }[];

  const expenses = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    pay: jest.fn(),
  };
  const incomes = {
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    create: jest.fn(),
  };
  const dailySales = { getDailySales: jest.fn() };
  const incomeStatement = { getIncomeStatement: jest.fn() };

  const owner: ToolCaller = { userId: 9, keyId: 4, ownerUserId: 1 };

  async function connect(caller: ToolCaller = owner) {
    ({ client } = await connectTestClient({
      prisma,
      services: { prisma, ...services },
      authorization: auth,
      caller,
    }));
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* mensaje de error en texto plano */
    }
    return { isError: Boolean(res.isError), body, text };
  };

  const expenseArgs = {
    amount: 250,
    concept: 'Papelería',
    date: '2026-11-20',
    invoiced: false,
    account_id: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    actions = fakeActions();
    closed = [];
    prisma = {
      mcpAction: actions,
      monthlyClose: {
        findUnique: jest.fn(({ where }) => {
          const { year, month } = where.user_id_year_month;
          return Promise.resolve(
            closed.some((c) => c.year === year && c.month === month)
              ? { status: 'CLOSED' }
              : null,
          );
        }),
      },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      income: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 1, name: 'Chris', email: 'c@x' }),
      },
    };
    let nextExpense = 100;
    expenses.create.mockImplementation((_ctx, dto) =>
      Promise.resolve({ id: nextExpense++, ...dto }),
    );
    expenses.findOne.mockImplementation((_ctx, id) =>
      Promise.resolve({ id, ...expenseArgs }),
    );
    services = {
      expenses: expenses as any,
      incomes: incomes as any,
      dailySales: dailySales as any,
      incomeStatement: incomeStatement as any,
    };
    auth = {
      requireContext: jest.fn((userId: number) =>
        Promise.resolve({ userId, scope: 'OWN' }),
      ),
    };
  });

  describe('registro', () => {
    it('expone exactamente las tools enumeradas', async () => {
      await connect();
      const { tools } = await client.listTools();

      expect(tools.map((t) => t.name).sort()).toEqual(
        [...READ_TOOLS, ...WRITE_TOOLS].sort(),
      );
    });

    it('las anotaciones corresponden a lo que hace cada tool', async () => {
      await connect();
      const { tools } = await client.listTools();

      for (const tool of tools) {
        const read = READ_TOOLS.includes(tool.name);
        expect(tool.annotations?.readOnlyHint).toBe(read);
        expect(tool.annotations?.destructiveHint).toBe(
          /_delete$/.test(tool.name),
        );
      }
    });

    it('las altas aceptan client_ref y los borrados confirmation_token', async () => {
      await connect();
      const { tools } = await client.listTools();
      const props = (name: string) =>
        Object.keys(
          (tools.find((t) => t.name === name)!.inputSchema as any).properties ??
            {},
        );

      expect(props('expense_create')).toContain('client_ref');
      expect(props('payable_add_payment')).toContain('client_ref');
      expect(props('expense_delete')).toContain('confirmation_token');
      expect(props('expenses_create_bulk')).toEqual(['items']);
    });

    /*
     * La lista negra es estructural: ni el nombre ni los argumentos de ninguna
     * tool llegan a usuarios, roles, permisos, invitaciones, llaves MCP,
     * Shopify, cierre de mes o autenticación, aunque el rol lo permitiera.
     */
    it('no hay camino a la lista negra', async () => {
      await connect();
      const { tools } = await client.listTools();
      const denied =
        /user|role|permission|invit|mcp_key|shopify|credential|password|login|auth|close_month|reopen|recalculate/i;

      for (const tool of tools) {
        expect(tool.name).not.toMatch(denied);
        for (const arg of Object.keys(
          (tool.inputSchema as any).properties ?? {},
        )) {
          expect(arg).not.toMatch(
            /owner|on_behalf|user_id|role|invit|credential|shopify_access/i,
          );
        }
      }
      const names = tools.map((t) => t.name);
      expect(names.filter((n) => /monthly_close/.test(n))).toEqual([
        'monthly_close_status',
      ]);
    });

    it('el permiso de cada escritura corresponde a su verbo', async () => {
      const { toolkit } = await connectTestClient({
        prisma,
        services,
        authorization: auth,
      });
      for (const def of toolkit.registry) {
        const [, action] = def.permission.split(':');
        if (def.kind === 'read') expect(action).toBe('read');
        if (def.kind === 'delete')
          expect(['delete', 'update']).toContain(action);
        if (def.kind === 'update') expect(action).toBe('update');
      }
    });
  });

  describe('lecturas', () => {
    it('sales_daily pide report:read y delega al servicio de REST', async () => {
      dailySales.getDailySales.mockResolvedValue({
        totals: { net_sales: 150 },
      });
      await connect();

      const { body } = await call('sales_daily', {
        start_date: '2026-08-01',
        end_date: '2026-08-03',
      });

      expect(auth.requireContext).toHaveBeenCalledWith(9, 'report:read');
      expect(dailySales.getDailySales).toHaveBeenCalledWith(
        { userId: 9, scope: 'OWN', ownerUserId: 1 },
        expect.objectContaining({
          start_date: '2026-08-01',
          end_date: '2026-08-03',
        }),
      );
      expect(body.totals.net_sales).toBe(150);
    });

    it('income_statement exige las dos fechas', async () => {
      await connect();

      const { isError } = await call('income_statement', {
        start_date: '2026-04-01',
      });

      expect(isError).toBe(true);
      expect(incomeStatement.getIncomeStatement).not.toHaveBeenCalled();
    });

    it('context_get marca como no disponible lo que el rol no puede leer', async () => {
      auth.requireContext.mockImplementation(
        (userId: number, permission: string) =>
          permission === 'report:read'
            ? Promise.resolve({ userId, scope: 'OWN' })
            : Promise.reject(
                new ForbiddenException(`Missing permission: ${permission}`),
              ),
      );
      await connect();

      const { body } = await call('context_get', {});

      expect(body.books_owner.name).toBe('Chris');
      expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.employees).toEqual({
        unavailable: true,
        reason: 'Tu rol no tiene employee:read',
      });
    });
  });

  describe('escrituras', () => {
    it('responden con el sobre uniforme y quedan en la bitácora', async () => {
      await connect();

      const { body, isError } = await call('expense_create', expenseArgs);

      expect(isError).toBe(false);
      expect(body.entity.id).toBe(100);
      expect(body.warnings).toEqual([]);
      expect(actions.rows[0]).toMatchObject({
        tool: 'expense_create',
        entity: 'expense',
        entity_id: 100,
        action: 'create',
        owner_user_id: 1,
        key_id: 4,
      });
      expect(body.action_id).toBe(actions.rows[0].id);
    });

    it('validan con el DTO de REST lo que zod no ve (fecha inválida)', async () => {
      await connect();

      const { isError, text } = await call('expense_create', {
        ...expenseArgs,
        date: 'ayer',
      });

      expect(isError).toBe(true);
      expect(text).toMatch(/date/);
      expect(expenses.create).not.toHaveBeenCalled();
    });

    it('una llave sin dueño no escribe', async () => {
      await connect({ userId: 9, keyId: 4, ownerUserId: null });

      const { isError } = await call('expense_create', expenseArgs);

      expect(isError).toBe(true);
      expect(expenses.create).not.toHaveBeenCalled();
    });

    it('update guarda el estado anterior y el nuevo', async () => {
      expenses.update.mockResolvedValue({ id: 7, ...expenseArgs, amount: 300 });
      await connect();

      await call('expense_update', { id: 7, amount: 300 });

      expect(expenses.update).toHaveBeenCalledWith(
        expect.anything(),
        7,
        expect.objectContaining({ amount: 300 }),
      );
      expect(actions.rows[0]).toMatchObject({ action: 'update', entity_id: 7 });
      expect(actions.rows[0].before.amount).toBe(250);
      expect(actions.rows[0].after.amount).toBe(300);
    });
  });

  describe('idempotencia', () => {
    it('repetir el client_ref no duplica y devuelve el original', async () => {
      await connect();

      const first = await call('expense_create', {
        ...expenseArgs,
        client_ref: 'ticket-8841',
      });
      const second = await call('expense_create', {
        ...expenseArgs,
        client_ref: 'ticket-8841',
      });

      expect(expenses.create).toHaveBeenCalledTimes(1);
      expect(second.body.duplicate).toBe(true);
      expect(second.body.entity.id).toBe(first.body.entity.id);
      expect(second.body.warnings[0].code).toBe('DUPLICATE_CLIENT_REF');
    });

    it('si el alta falla, libera el client_ref para reintentar', async () => {
      expenses.create.mockRejectedValueOnce(new Error('boom'));
      await connect();

      expect(
        (await call('expense_create', { ...expenseArgs, client_ref: 'r1' }))
          .isError,
      ).toBe(true);
      const retry = await call('expense_create', {
        ...expenseArgs,
        client_ref: 'r1',
      });

      expect(retry.isError).toBe(false);
      expect(retry.body.duplicate).toBeUndefined();
    });

    it('dos llamadas simultáneas con el mismo client_ref crean una sola', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      expenses.create.mockImplementationOnce(async (_ctx, dto) => {
        await gate;
        return { id: 555, ...dto };
      });
      await connect();

      const a = call('expense_create', { ...expenseArgs, client_ref: 'same' });
      const b = call('expense_create', { ...expenseArgs, client_ref: 'same' });
      const second = await b;
      release();
      await a;

      expect(expenses.create).toHaveBeenCalledTimes(1);
      expect(second.isError).toBe(true);
      expect(second.text).toMatch(/sigue en curso/);
    });
  });

  describe('avisos', () => {
    it('avisa del mes cerrado calculándolo en la zona del negocio', async () => {
      closed = [{ year: 2026, month: 10 }];
      await connect();

      /* 31 de octubre 20:00 en CDMX ya es noviembre en UTC. */
      const { body } = await call('expense_create', {
        ...expenseArgs,
        date: '2026-10-31T20:00:00-06:00',
      });

      expect(body.entity.id).toBeDefined();
      expect(body.warnings).toEqual([
        expect.objectContaining({ code: 'CLOSED_MONTH', month: '2026-10' }),
      ]);
    });

    it('avisa de un posible duplicado sin bloquear', async () => {
      prisma.expense.findMany.mockResolvedValue([
        { id: 41, concept: 'papeleria ', account_id: 99, vendor: null },
      ]);
      await connect();

      const { body } = await call('expense_create', expenseArgs);

      expect(expenses.create).toHaveBeenCalled();
      expect(body.warnings[0]).toMatchObject({
        code: 'POSSIBLE_DUPLICATE',
        ids: [41],
      });
    });

    it('si la bitácora falla dos veces, se guarda igual y se avisa', async () => {
      actions.create
        .mockRejectedValueOnce(new Error('db'))
        .mockRejectedValueOnce(new Error('db'));
      await connect();

      const { body } = await call('expense_create', expenseArgs);

      expect(body.entity.id).toBe(100);
      expect(body.action_id).toBeNull();
      expect(body.warnings.map((w: any) => w.code)).toContain(
        'ACTION_NOT_LOGGED',
      );
    });
  });

  describe('borrado en dos pasos', () => {
    const createdByAgent = async () => {
      await call('expense_create', expenseArgs);
      return actions.rows[0].entity_id as number;
    };

    it('no borra lo que no creó el agente', async () => {
      await connect();

      const { isError, text } = await call('expense_delete', { id: 3 });

      expect(isError).toBe(true);
      expect(text).toMatch(/no lo creó el agente/);
      expect(expenses.remove).not.toHaveBeenCalled();
    });

    it('sin token devuelve la vista previa; con el token borra', async () => {
      await connect();
      const id = await createdByAgent();

      const preview = await call('expense_delete', { id });
      expect(expenses.remove).not.toHaveBeenCalled();
      expect(preview.body.preview.id).toBe(id);
      expect(preview.body.confirmation_token).toBeDefined();

      const done = await call('expense_delete', {
        id,
        confirmation_token: preview.body.confirmation_token,
      });
      expect(done.body.deleted).toBe(true);
      expect(expenses.remove).toHaveBeenCalledWith(expect.anything(), id);
      expect(actions.rows[actions.rows.length - 1]).toMatchObject({
        action: 'delete',
        entity_id: id,
      });
    });

    it('rechaza un token de otro registro', async () => {
      await connect();
      const id = await createdByAgent();
      await call('expense_create', expenseArgs);
      const other = actions.rows[1].entity_id as number;

      const preview = await call('expense_delete', { id: other });
      const res = await call('expense_delete', {
        id,
        confirmation_token: preview.body.confirmation_token,
      });

      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/no corresponde/);
      expect(expenses.remove).not.toHaveBeenCalled();
    });

    it('rechaza un token vencido', async () => {
      await connect();
      const id = await createdByAgent();
      const preview = await call('expense_delete', { id });
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);

      const res = await call('expense_delete', {
        id,
        confirmation_token: preview.body.confirmation_token,
      });
      spy.mockRestore();

      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/venció/);
      expect(expenses.remove).not.toHaveBeenCalled();
    });
  });

  describe('carga masiva', () => {
    it('procesa cada renglón por separado y resume', async () => {
      await connect();

      const { body } = await call('expenses_create_bulk', {
        items: [
          { ...expenseArgs, client_ref: 'l1' },
          { ...expenseArgs, date: 'mal', client_ref: 'l2' },
          { ...expenseArgs, client_ref: 'l3' },
        ],
      });

      expect(body.summary).toEqual({
        total: 3,
        created: 2,
        duplicates: 0,
        errors: 1,
      });
      expect(body.results[1]).toMatchObject({
        index: 1,
        status: 'error',
        client_ref: 'l2',
      });
    });

    it('reenviar el lote sólo agrega lo que faltaba', async () => {
      await connect();
      const items = [
        { ...expenseArgs, client_ref: 'l1' },
        { ...expenseArgs, client_ref: 'l2' },
      ];
      await call('expenses_create_bulk', { items });

      const { body } = await call('expenses_create_bulk', {
        items: [...items, { ...expenseArgs, client_ref: 'l3' }],
      });

      expect(body.summary).toMatchObject({ created: 1, duplicates: 2 });
      expect(expenses.create).toHaveBeenCalledTimes(3);
    });
  });

  it('un ingreso de Shopify no se edita ni se borra desde el agente', async () => {
    incomes.findOne.mockResolvedValue({ id: 5, shopify_order_id: 77 });
    await connect();

    const { isError, text } = await call('income_update', {
      id: 5,
      concept: 'x',
    });

    expect(isError).toBe(true);
    expect(text).toMatch(/viene de Shopify/);
    expect(incomes.update).not.toHaveBeenCalled();
  });
});
