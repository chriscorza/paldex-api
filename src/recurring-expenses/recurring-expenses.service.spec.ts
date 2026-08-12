import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { RecurringExpensesService } from './recurring-expenses.service';
import { CloseGuard } from '../monthly-close/close-guard';

/*
 * Dar de alta la renta, los servicios y demás gastos fijos de meses anteriores.
 * Generados en PENDING no cuentan en ningún reporte —el P&L suma por `paid_at`
 * con `status: PAID`— y liquidarlos era uno por uno.
 */
describe('RecurringExpensesService — carga de histórico', () => {
  let service: RecurringExpensesService;
  let prisma: any;

  const plantilla = {
    id: 1,
    concept: 'Renta',
    amount: 15000,
    category_id: 3,
    account_id: 2,
    frequency: 'MONTHLY',
    due_day_of_week: null,
    due_day_of_month: 1,
    second_due_day_of_month: null,
    start_date: new Date('2026-01-01'),
    end_date: null,
  };

  const ctx = { userId: 1, scope: 'OWN' } as any;

  beforeEach(async () => {
    prisma = {
      recurringExpense: { findMany: jest.fn().mockResolvedValue([plantilla]) },
      expense: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloseGuard, useValue: { ensureOpen: jest.fn() } },
      ],
    }).compile();

    service = module.get<RecurringExpensesService>(RecurringExpensesService);
  });

  it('convierte las fechas de la plantilla antes de guardarla', async () => {
    prisma.recurringExpense.create = jest.fn().mockResolvedValue({});

    await service.create(ctx, {
      concept: 'Renta local',
      amount: 7281.9,
      category_id: 2,
      frequency: 'MONTHLY' as any,
      due_day_of_month: 6,
      start_date: '2025-05-06',
      end_date: '2025-12-06',
    });

    const { data } = prisma.recurringExpense.create.mock.calls[0][0];
    /* En cadena, Prisma responde «premature end of input» y devuelve un 500. */
    expect(data.start_date).toBeInstanceOf(Date);
    expect(data.end_date).toBeInstanceOf(Date);
  });

  const rowsCreated = () =>
    prisma.expense.create.mock.calls.map((c: any[]) => c[0].data);

  it('deja pagado lo que ya venció, con la fecha del vencimiento', async () => {
    const result = await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-04-30',
      already_paid: true,
    });

    const rows = rowsCreated();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe('PAID');
      expect(row.paid_at).toEqual(row.scheduled_due_date);
    }
    expect(result.paid).toBe(rows.length);
  });

  it('no da por pagado lo que todavía no vence', async () => {
    const proximoAño = new Date().getFullYear() + 1;

    await service.generate(ctx, {
      start_date: `${proximoAño}-01-01`,
      end_date: `${proximoAño}-06-30`,
      already_paid: true,
    });

    for (const row of rowsCreated()) {
      expect(row.status).toBe('PENDING');
      expect(row.paid_at).toBeNull();
    }
  });

  it('sin el flag sigue generando en PENDING', async () => {
    const result = await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-04-30',
    });

    for (const row of rowsCreated()) {
      expect(row.status).toBe('PENDING');
      expect(row.paid_at).toBeNull();
    }
    expect(result.paid).toBe(0);
  });

  /* La plantilla manda: no se inventa historia anterior a su alta. */
  it('no genera nada anterior al inicio de la plantilla', async () => {
    await service.generate(ctx, {
      start_date: '2025-06-01',
      end_date: '2025-12-31',
      already_paid: true,
    });

    expect(prisma.expense.create).not.toHaveBeenCalled();
  });
});

/*
 * Un gasto fijo que llega con factura. La plantilla generaba siempre
 * `NOT_INVOICED`, así que caía en el cubo de "sin factura" del reporte fiscal y
 * su IVA no se acreditaba en ningún lado.
 */
describe('RecurringExpensesService — gastos facturados', () => {
  let prisma: any;
  let service: RecurringExpensesService;

  const ctx = { userId: 1, scope: 'OWN' } as any;

  const build = async (overrides: any) => {
    prisma = {
      recurringExpense: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            concept: 'Estacionamiento',
            amount: 1000,
            category_id: 18,
            account_id: 1,
            frequency: 'MONTHLY',
            due_day_of_week: null,
            due_day_of_month: 5,
            second_due_day_of_month: null,
            start_date: new Date('2026-01-01'),
            end_date: null,
            invoice_status: 'NOT_INVOICED',
            tax_rate: null,
            ...overrides,
          },
        ]),
      },
      expense: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloseGuard, useValue: { ensureOpen: jest.fn() } },
      ],
    }).compile();

    return module.get<RecurringExpensesService>(RecurringExpensesService);
  };

  const firstRow = () => prisma.expense.create.mock.calls[0][0].data;

  it('marca como facturado lo que la plantilla dice que lo es', async () => {
    service = await build({ invoice_status: 'INVOICED' });

    await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-02-28',
    });

    expect(firstRow().invoice_status).toBe('INVOICED');
    expect(firstRow().invoiced).toBe(true);
  });

  it('desglosa el IVA que viene dentro del importe', async () => {
    service = await build({ invoice_status: 'INVOICED', tax_rate: 16 });

    await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-02-28',
    });

    const row = firstRow();
    expect(row.subtotal).toBe(862.07);
    expect(row.tax_amount).toBe(137.93);
    expect(row.tax_creditable_amount).toBe(137.93);
    /* El importe pagado no se toca: el IVA iba dentro. */
    expect(Number(row.amount)).toBe(1000);
  });

  it('no inventa IVA cuando la plantilla no lo declara', async () => {
    service = await build({ invoice_status: 'INVOICED' });

    await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-02-28',
    });

    const row = firstRow();
    expect(row.subtotal).toBeNull();
    expect(row.tax_amount).toBeNull();
    expect(row.tax_creditable_amount).toBe(0);
  });

  it('deja de ser deducible si la plantilla lo dice', async () => {
    service = await build({ invoice_status: 'NOT_DEDUCTIBLE' });

    await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-02-28',
    });

    expect(firstRow().is_tax_deductible).toBe(false);
    expect(firstRow().invoiced).toBe(false);
  });
});
