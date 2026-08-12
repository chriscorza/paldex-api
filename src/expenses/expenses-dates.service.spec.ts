import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ExpensesService } from './expenses.service';

/*
 * El selector de fecha del frontend manda "YYYY-MM-DD". Prisma quiere un
 * DateTime ISO-8601 y rechaza esa forma con «premature end of input», así que
 * crear un gasto desde la UI respondía 500 — nunca había funcionado.
 *
 * Y no vale con `new Date(...)`: eso da medianoche UTC, seis horas antes de que
 * empiece el día en la zona del negocio, y un gasto del día 1 se contaría en el
 * mes anterior.
 */
describe('ExpensesService — fechas que llegan como día suelto', () => {
  let service: ExpensesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      expense: {
        create: jest.fn().mockResolvedValue({ id: 1, taxes: [] }),
        findFirst: jest.fn().mockResolvedValue({ id: 1, taxes: [] }),
        update: jest.fn().mockResolvedValue({ id: 1, taxes: [] }),
      },
      account: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      expenseCategory: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
      $transaction: jest.fn((fn: any) =>
        typeof fn === 'function' ? fn(prisma) : Promise.all(fn),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .useMocker(() => ({ ensureOpen: jest.fn() }))
      .compile();

    service = module.get<ExpensesService>(ExpensesService);
  });

  const ctx = { userId: 1, scope: 'OWN' } as any;

  it('acepta el formato que manda el formulario', async () => {
    await service.create(ctx, {
      amount: 100,
      concept: 'Renta local',
      date: '2026-08-11',
      invoiced: false,
      account_id: 1,
      category_id: 2,
    } as any);

    const { data } = prisma.expense.create.mock.calls[0][0];
    expect(data.date).toBeInstanceOf(Date);
  });

  /* El día 1 tiene que caer dentro de su mes, no en el anterior. */
  it('ancla el día a la medianoche del negocio, no a la de UTC', async () => {
    await service.create(ctx, {
      amount: 100,
      concept: 'Renta local',
      date: '2026-08-01',
      invoiced: false,
      account_id: 1,
      category_id: 2,
    } as any);

    const { data } = prisma.expense.create.mock.calls[0][0];
    expect(data.date.toISOString()).toBe('2026-08-01T06:00:00.000Z');
  });

  it('respeta una fecha que ya trae hora', async () => {
    await service.create(ctx, {
      amount: 100,
      concept: 'Renta local',
      date: '2026-08-11T15:30:00.000Z',
      invoiced: false,
      account_id: 1,
      category_id: 2,
    } as any);

    const { data } = prisma.expense.create.mock.calls[0][0];
    expect(data.date.toISOString()).toBe('2026-08-11T15:30:00.000Z');
  });
});
