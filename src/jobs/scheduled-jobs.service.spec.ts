import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { RecurringExpensesService } from '../recurring-expenses/recurring-expenses.service';
import { ShopifyReconciliationService } from '../shopify/shopify-reconciliation.service';
import { InventorySnapshotService } from '../inventory/inventory-snapshot.service';
import { ScheduledJobsService } from './scheduled-jobs.service';

describe('ScheduledJobsService', () => {
  let service: ScheduledJobsService;
  let prisma: any;
  let payroll: any;
  let recurring: any;
  let reconciliation: any;
  let inventorySnapshots: any;

  const nothingGenerated = { created: 0, paid: 0, skipped: 0 };

  beforeEach(async () => {
    delete process.env.SCHEDULED_JOBS_ENABLED;

    prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([{ user_id: 7 }]) },
      recurringExpense: {
        findMany: jest.fn().mockResolvedValue([{ user_id: 7 }]),
      },
      shopifyConnection: {
        findMany: jest.fn().mockResolvedValue([{ user_id: 7 }]),
      },
    };
    payroll = { generate: jest.fn().mockResolvedValue(nothingGenerated) };
    recurring = { generate: jest.fn().mockResolvedValue(nothingGenerated) };
    reconciliation = {
      reconcileAll: jest
        .fn()
        .mockResolvedValue({ connections: 1, discrepancies: 0 }),
    };
    inventorySnapshots = {
      captureForOwner: jest.fn().mockResolvedValue([
        {
          id: 1,
          total_units: 120,
          total_cost: 10200,
          products_without_cost: 0,
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledJobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayrollService, useValue: payroll },
        { provide: RecurringExpensesService, useValue: recurring },
        { provide: ShopifyReconciliationService, useValue: reconciliation },
        { provide: InventorySnapshotService, useValue: inventorySnapshots },
      ],
    }).compile();

    service = module.get<ScheduledJobsService>(ScheduledJobsService);
  });

  /*
   * Lo que más importa de todo el archivo: `RecurringExpensesService.generate`
   * escribe `user_id: ctx.userId` en cada gasto que crea. Con un contexto 'ANY'
   * —o con un id de sistema inventado— los gastos nacerían colgados de quien no
   * es y desaparecerían de los reportes de su dueño.
   */
  it('genera con el contexto de cada dueño, no con uno global', async () => {
    prisma.recurringExpense.findMany.mockResolvedValue([
      { user_id: 7 },
      { user_id: 9 },
    ]);

    await service.generateRecurringExpenses();

    expect(recurring.generate).toHaveBeenCalledTimes(2);
    expect(recurring.generate.mock.calls[0][0]).toEqual({
      userId: 7,
      scope: 'OWN',
    });
    expect(recurring.generate.mock.calls[1][0]).toEqual({
      userId: 9,
      scope: 'OWN',
    });
  });

  it('pide un dueño por usuario, no uno por empleado', async () => {
    await service.generatePayroll();

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['user_id'] }),
    );
  });

  /*
   * La ventana mira hacia atrás para que un día de caída no deje un periodo sin
   * generar para siempre: ambas generaciones saltan lo que ya existe, así que
   * el solape se paga solo.
   */
  it('abarca desde antes de hoy hasta bastante después', async () => {
    await service.generatePayroll();

    const { start_date, end_date } = payroll.generate.mock.calls[0][1];
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    expect(new Date(start_date).getTime()).toBeLessThan(now);
    expect(now - new Date(start_date).getTime()).toBeGreaterThanOrEqual(
      6 * day,
    );
    expect(new Date(end_date).getTime() - now).toBeGreaterThan(40 * day);
  });

  /* Nunca da por pagado lo que vence: eso es sólo para cargar histórico. */
  it('no marca nada como pagado', async () => {
    await service.generatePayroll();
    await service.generateRecurringExpenses();

    expect(payroll.generate.mock.calls[0][1].already_paid).toBeUndefined();
    expect(recurring.generate.mock.calls[0][1].already_paid).toBeUndefined();
  });

  it('sigue con los demás dueños cuando uno falla', async () => {
    prisma.employee.findMany.mockResolvedValue([
      { user_id: 7 },
      { user_id: 9 },
    ]);
    payroll.generate.mockRejectedValueOnce(new Error('base caída'));

    await service.generatePayroll();

    expect(payroll.generate).toHaveBeenCalledTimes(2);
  });

  it('no tumba el cron cuando Shopify no responde', async () => {
    reconciliation.reconcileAll.mockRejectedValue(new Error('502'));

    await expect(service.reconcileShopify()).resolves.toBeUndefined();
  });

  describe('interruptor', () => {
    it('no genera ni reconcilia con SCHEDULED_JOBS_ENABLED=false', async () => {
      process.env.SCHEDULED_JOBS_ENABLED = 'false';

      await service.generatePayroll();
      await service.generateRecurringExpenses();
      await service.reconcileShopify();

      expect(payroll.generate).not.toHaveBeenCalled();
      expect(recurring.generate).not.toHaveBeenCalled();
      expect(reconciliation.reconcileAll).not.toHaveBeenCalled();
    });

    /* Sin la variable corre: olvidarla al desplegar no debe apagar la nómina. */
    it('corre cuando la variable no está puesta', async () => {
      await service.generatePayroll();

      expect(payroll.generate).toHaveBeenCalled();
    });
  });

  describe('foto de inventario', () => {
    /*
     * Misma razón que la generación de gastos: la foto se cuelga del usuario y
     * se valúa con **su** catálogo de costos. Una corrida global se las
     * atribuiría todas al mismo dueño.
     */
    it('toma la foto con el contexto de cada dueño', async () => {
      prisma.shopifyConnection.findMany.mockResolvedValue([
        { user_id: 7 },
        { user_id: 9 },
      ]);

      await service.captureInventory();

      expect(inventorySnapshots.captureForOwner).toHaveBeenCalledTimes(2);
      expect(inventorySnapshots.captureForOwner.mock.calls[0][0]).toEqual({
        userId: 7,
        scope: 'OWN',
      });
      expect(inventorySnapshots.captureForOwner.mock.calls[1][0]).toEqual({
        userId: 9,
        scope: 'OWN',
      });
    });

    it('sólo mira las conexiones activas, una vez por dueño', async () => {
      await service.captureInventory();

      expect(prisma.shopifyConnection.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
        distinct: ['user_id'],
        select: { user_id: true },
      });
    });

    it('un dueño que falla no detiene a los demás', async () => {
      prisma.shopifyConnection.findMany.mockResolvedValue([
        { user_id: 7 },
        { user_id: 9 },
      ]);
      inventorySnapshots.captureForOwner
        .mockRejectedValueOnce(new Error('token vencido'))
        .mockResolvedValueOnce([
          { id: 2, total_units: 1, total_cost: 1, products_without_cost: 0 },
        ]);

      await expect(service.captureInventory()).resolves.toBeUndefined();

      expect(inventorySnapshots.captureForOwner).toHaveBeenCalledTimes(2);
    });

    it('no corre con los trabajos deshabilitados', async () => {
      process.env.SCHEDULED_JOBS_ENABLED = 'false';

      await service.captureInventory();

      expect(prisma.shopifyConnection.findMany).not.toHaveBeenCalled();
      expect(inventorySnapshots.captureForOwner).not.toHaveBeenCalled();
    });
  });
});
