import { Prisma } from '@prisma/client';
import { MonthlyCloseService } from './monthly-close.service';
import { OwnershipContext } from '../common/ownership';

const Decimal = Prisma.Decimal;

/*
 * La depreciación se calcula al leer, así que editar un activo cambia meses ya
 * cerrados. El fingerprint del cierre tiene que verlo, igual que ve un gasto
 * editado.
 */
describe('MonthlyCloseService — fingerprint de activos fijos', () => {
  const ctx: OwnershipContext = { userId: 1, scope: 'OWN' };
  const empty = { _sum: {}, _count: 0 };

  const asset = (useful_life_months: number) => ({
    id: 5,
    acquisition_cost: new Decimal(12000),
    salvage_value: new Decimal(0),
    useful_life_months,
    in_service_at: new Date('2026-03-10T18:00:00Z'),
    disposed_at: null,
    disposal_amount: null,
  });

  const build = (assets: unknown[], stored: Record<string, unknown>) => {
    const prisma: any = {
      monthlyClose: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'CLOSED',
          fingerprint_version: 1,
          source_fingerprint: stored,
        }),
      },
      expense: { aggregate: jest.fn().mockResolvedValue(empty) },
      income: { aggregate: jest.fn().mockResolvedValue(empty) },
      payrollPayment: { aggregate: jest.fn().mockResolvedValue(empty) },
      taxPayment: { aggregate: jest.fn().mockResolvedValue(empty) },
      costOfGoodsSold: { aggregate: jest.fn().mockResolvedValue(empty) },
      fixedAsset: { findMany: jest.fn().mockResolvedValue(assets) },
    };
    return new MonthlyCloseService(prisma, {} as any, {} as any);
  };

  const zeros = {
    expenses: { count: 0, sum: '0' },
    incomes: { count: 0, sum: '0' },
    payroll_payments: { count: 0, sum: '0' },
    tax_payments: { count: 0, sum: '0' },
    cost_of_goods_sold: { count: 0, sum: '0' },
  };

  it('cambiar la vida útil de un activo desactualiza el mes cerrado', async () => {
    /* Cerrado con vida de 12 meses (1,000 en abril); hoy tiene 24 (500). */
    const service = build([asset(24)], {
      ...zeros,
      fixed_assets: { count: 1, sum: '1000' },
    });

    const result = await service.checkIntegrity(ctx, 2026, 4);

    expect(result.status).toBe('DIVERGED');
    expect((result as any).detail).toContain('fixed_assets');
  });

  it('sin cambios, el mes sigue OK', async () => {
    const service = build([asset(12)], {
      ...zeros,
      fixed_assets: { count: 1, sum: '1000' },
    });

    expect((await service.checkIntegrity(ctx, 2026, 4)).status).toBe('OK');
  });

  /* Cerrado antes de que existieran los activos: no se marca por eso. */
  it('un cierre anterior sin fixed_assets no se da por desactualizado', async () => {
    const service = build([asset(12)], zeros);

    expect((await service.checkIntegrity(ctx, 2026, 4)).status).toBe('OK');
  });
});
