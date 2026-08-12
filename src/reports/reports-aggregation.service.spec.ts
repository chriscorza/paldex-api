import { ReportsAggregationService } from './reports-aggregation.service';
import { PrismaService } from '../prisma.service';
import { OwnershipContext } from '../common/ownership';

/*
 * Los seis totales de gasto estaban fijos en cero, así que registrar gastos no
 * movía el P&L: la utilidad operativa salía siempre igual a la bruta.
 */
describe('ReportsAggregationService — los gastos entran al P&L', () => {
  const ctx: OwnershipContext = { userId: 1, scope: 'OWN' };

  const categories = [
    {
      id: 1,
      type: 'COGS',
      name: 'Compra de mercancía',
      affects_operating_profit: false,
    },
    {
      id: 2,
      type: 'OPERATING',
      name: 'Renta local',
      affects_operating_profit: true,
    },
    {
      id: 11,
      type: 'DEBT',
      name: 'Intereses de deuda',
      affects_operating_profit: true,
    },
    {
      id: 12,
      type: 'DEBT',
      name: 'Pago de capital de deuda',
      affects_operating_profit: false,
    },
    {
      id: 13,
      type: 'OWNER',
      name: 'Retiro del dueño',
      affects_operating_profit: false,
    },
    {
      id: 14,
      type: 'OWNER',
      name: 'Reinversión',
      affects_operating_profit: false,
    },
  ];

  const build = (paidByCategory: any[], pending = 0) => {
    const empty = { _sum: {}, _count: { id: 0 } };
    const prisma: any = {
      income: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      costOfGoodsSold: { aggregate: jest.fn().mockResolvedValue(empty) },
      expenseCategory: { findMany: jest.fn().mockResolvedValue(categories) },
      payrollPayment: { aggregate: jest.fn().mockResolvedValue(empty) },
      taxPayment: { aggregate: jest.fn().mockResolvedValue(empty) },
      expense: {
        groupBy: jest.fn().mockResolvedValue(paidByCategory),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: pending } }),
      },
    };
    return new ReportsAggregationService(prisma as PrismaService);
  };

  const run = (service: ReportsAggregationService) =>
    service.getMonthlyAggregates(
      ctx,
      new Date('2026-07-01T06:00:00Z'),
      new Date('2026-08-01T05:59:59.999Z'),
    );

  it('suma como operativo lo que su categoría marca así', async () => {
    const service = build([{ category_id: 2, _sum: { amount: 8508.6 } }]);

    const aggregates = await run(service);

    expect(Number(aggregates.operating_expenses)).toBe(8508.6);
  });

  /* La mercancía se resta por CostOfGoodsSold; como gasto sería doble conteo. */
  it('deja la compra de inventario fuera de la operación', async () => {
    const service = build([{ category_id: 1, _sum: { amount: 50000 } }]);

    const aggregates = await run(service);

    expect(Number(aggregates.operating_expenses)).toBe(0);
    expect(Number(aggregates.inventory_purchases)).toBe(50000);
  });

  it('separa los intereses de deuda del pago de capital', async () => {
    const service = build([
      { category_id: 11, _sum: { amount: 1200 } },
      { category_id: 12, _sum: { amount: 5000 } },
    ]);

    const aggregates = await run(service);

    expect(Number(aggregates.operating_expenses)).toBe(1200);
    expect(Number(aggregates.debt_principal_paid)).toBe(5000);
  });

  it('distingue el retiro del dueño de la reinversión', async () => {
    const service = build([
      { category_id: 13, _sum: { amount: 20000 } },
      { category_id: 14, _sum: { amount: 7000 } },
    ]);

    const aggregates = await run(service);

    expect(Number(aggregates.owner_withdrawals)).toBe(20000);
    expect(Number(aggregates.reinvestment)).toBe(7000);
    /* Ninguno reduce la operación: son movimientos del dueño, no gasto. */
    expect(Number(aggregates.operating_expenses)).toBe(0);
  });

  it('cuenta como operativo el gasto sin categoría', async () => {
    const service = build([{ category_id: null, _sum: { amount: 300 } }]);

    const aggregates = await run(service);

    expect(Number(aggregates.operating_expenses)).toBe(300);
  });

  it('trae lo pendiente aparte de lo pagado', async () => {
    const service = build([{ category_id: 2, _sum: { amount: 8508.6 } }], 4000);

    const aggregates = await run(service);

    expect(Number(aggregates.pending_expenses)).toBe(4000);
    expect(Number(aggregates.operating_expenses)).toBe(8508.6);
  });
});
