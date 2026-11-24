import { ReportsAggregationService } from './reports-aggregation.service';
import { PrismaService } from '../prisma.service';
import { OwnershipContext } from '../common/ownership';
import { startOfDayInZone } from '../common/timezone';

/*
 * Saldo calculado por cuenta (openspec/changes/add-account-transfers):
 * traspasos, pagos a proveedores, cobros y saldo inicial con fecha.
 */
describe('ReportsAggregationService.getCashReport', () => {
  const ctx: OwnershipContext = { userId: 1, scope: 'OWN' };
  const jan1 = startOfDayInZone('2027-01-01');

  type Sums = Partial<
    Record<
      | 'income'
      | 'expense'
      | 'payroll'
      | 'tax'
      | 'in'
      | 'out'
      | 'payable'
      | 'collection',
      number
    >
  >;

  const build = (accounts: any[], sumsByAccount: Record<number, Sums>) => {
    const agg = (
      kind: keyof Sums,
      field: string,
      accountField = 'account_id',
    ) =>
      jest.fn(({ where }) => {
        const id = where[accountField];
        const value = sumsByAccount[id]?.[kind] ?? 0;
        return Promise.resolve({ _sum: { [field]: value } });
      });
    const prisma: any = {
      account: { findMany: jest.fn().mockResolvedValue(accounts) },
      income: { aggregate: agg('income', 'net_amount') },
      expense: { aggregate: agg('expense', 'amount') },
      payrollPayment: {
        aggregate: agg('payroll', 'net_amount'),
      },
      taxPayment: { aggregate: agg('tax', 'amount') },
      accountTransfer: {
        aggregate: jest.fn(({ where }) => {
          const id = where.to_account_id ?? where.from_account_id;
          const kind = where.to_account_id ? 'in' : 'out';
          return Promise.resolve({
            _sum: { amount: sumsByAccount[id]?.[kind] ?? 0 },
          });
        }),
      },
      payablePayment: { aggregate: agg('payable', 'amount') },
      receivableCollection: { aggregate: agg('collection', 'amount') },
    };
    prisma.payrollPayment.aggregate.mockImplementation(({ where }: any) => {
      if (where.status !== 'PAID') return Promise.resolve({ _sum: {} });
      return Promise.resolve({
        _sum: { net_amount: sumsByAccount[where.account_id]?.payroll ?? 0 },
      });
    });
    return {
      prisma,
      service: new ReportsAggregationService(prisma as PrismaService),
    };
  };

  const account = (overrides: Record<string, unknown>) => ({
    id: 1,
    name: 'BBVA',
    balance: 0,
    initial_balance: 0,
    initial_balance_at: null,
    is_active: true,
    ...overrides,
  });

  it('un traspaso mueve el saldo de las dos cuentas y no el total', async () => {
    const { service } = build(
      [account({ id: 3, name: 'Mercado Pago' }), account({ id: 1 })],
      {
        3: { income: 100000, out: 50000 },
        1: { in: 50000, expense: 10000 },
      },
    );

    const report = await service.getCashReport(ctx);
    const byId = Object.fromEntries(
      report.accounts.map((a: any) => [a.account_id, a]),
    );

    expect(byId[3].computed_balance).toBe(50000);
    expect(byId[1].computed_balance).toBe(40000);
    expect(byId[3].movements.transfers_out).toBe(50000);
    expect(byId[1].movements.transfers_in).toBe(50000);
    expect(report.available_cash).toBe(90000);
  });

  it('suma cobros y resta pagos a proveedores', async () => {
    const { service } = build([account({ id: 1 }), account({ id: 2 })], {
      1: { payable: 5000 },
      2: { collection: 2000 },
    });

    const report = await service.getCashReport(ctx);

    expect(report.accounts[0].computed_balance).toBe(-5000);
    expect(report.accounts[1].computed_balance).toBe(2000);
  });

  it('con saldo inicial fechado, sólo cuenta movimientos desde ese día', async () => {
    const { prisma, service } = build(
      [account({ initial_balance: 80000, initial_balance_at: jan1 })],
      { 1: { expense: 3000 } },
    );

    const report = await service.getCashReport(ctx);
    expect(report.accounts[0].computed_balance).toBe(77000);

    const incomeWhere = prisma.income.aggregate.mock.calls[0][0].where;
    expect(incomeWhere.date).toEqual({ gte: jan1 });

    const expenseWhere = prisma.expense.aggregate.mock.calls[0][0].where;
    expect(expenseWhere.OR).toEqual([
      { paid_at: { gte: jan1 } },
      { paid_at: null, date: { gte: jan1 } },
    ]);

    const transferWhere =
      prisma.accountTransfer.aggregate.mock.calls[0][0].where;
    expect(transferWhere.date).toEqual({ gte: jan1 });
    expect(
      prisma.payablePayment.aggregate.mock.calls[0][0].where.paid_at,
    ).toEqual({ gte: jan1 });
    expect(
      prisma.receivableCollection.aggregate.mock.calls[0][0].where.collected_at,
    ).toEqual({ gte: jan1 });
  });

  it('sin fecha de saldo inicial no filtra por fecha (comportamiento previo)', async () => {
    const { prisma, service } = build([account({})], {});

    await service.getCashReport(ctx);

    expect(prisma.income.aggregate.mock.calls[0][0].where.date).toBeUndefined();
    expect(prisma.expense.aggregate.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('filtra pagos y cobros por el dueño a través de su documento', async () => {
    const { prisma, service } = build([account({})], {});

    await service.getCashReport(ctx);

    expect(
      prisma.payablePayment.aggregate.mock.calls[0][0].where.payable,
    ).toEqual({ user_id: 1 });
    expect(
      prisma.receivableCollection.aggregate.mock.calls[0][0].where.receivable,
    ).toEqual({ user_id: 1 });
    expect(
      prisma.accountTransfer.aggregate.mock.calls[0][0].where.user_id,
    ).toBe(1);
  });
});
