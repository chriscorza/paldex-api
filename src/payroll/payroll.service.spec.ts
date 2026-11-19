import { Test, TestingModule } from '@nestjs/testing';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../prisma.service';
import { readFileSync } from 'fs';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

const ctx = { userId: 1, scope: 'ANY' as const };

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: any;

  const mockEmployee = {
    id: 1,
    name: 'Juan',
    pay_frequency: 'MONTHLY',
    base_salary: 30000,
    monthly_pay_day: 15,
    weekly_pay_day: null,
    biweekly_first_day: null,
    biweekly_second_day: null,
    started_at: new Date('2026-01-01'),
    ended_at: null,
    active: true,
    default_payment_account_id: null,
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      payrollPayment: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      account: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PayrollService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
  });

  describe('generate', () => {
    it('should generate PENDING payments for active employees', async () => {
      prisma.employee.findMany.mockResolvedValue([mockEmployee]);
      prisma.payrollPayment.create.mockResolvedValue({ id: 1 });

      const result = await service.generate(ctx, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      });

      expect(result.created).toBeGreaterThanOrEqual(1);
      expect(result.skipped).toBe(0);
    });

    it('should skip duplicates (P2002) and count them as skipped', async () => {
      prisma.employee.findMany.mockResolvedValue([mockEmployee]);
      const p2002 = Object.assign(new Error('Unique'), { code: 'P2002' });
      prisma.payrollPayment.create.mockRejectedValue(p2002);

      const result = await service.generate(ctx, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      });

      expect(result.created).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

    it('should mark payments as auto_generated', async () => {
      prisma.employee.findMany.mockResolvedValue([mockEmployee]);
      prisma.payrollPayment.create.mockResolvedValue({ id: 1 });

      await service.generate(ctx, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      });

      for (const call of prisma.payrollPayment.create.mock.calls) {
        expect(call[0].data.auto_generated).toBe(true);
        expect(call[0].data.status).toBe('PENDING');
      }
    });

    it('should exclude inactive employees', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      const result = await service.generate(ctx, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      });

      expect(result.created).toBe(0);
    });
  });

  describe('createManual', () => {
    it('should calculate net_amount = gross - deductions + bonuses', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.payrollPayment.create.mockResolvedValue({
        id: 1,
        net_amount: 29500,
      });

      const result = await service.createManual(ctx, {
        employee_id: 1,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        scheduled_pay_date: '2026-01-15',
        gross_amount: 30000,
        deductions: 1000,
        bonuses: 500,
      });

      expect(result.net_amount).toBe(29500);
    });

    it('should mark as not auto_generated', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.payrollPayment.create.mockResolvedValue({ id: 1 });

      await service.createManual(ctx, {
        employee_id: 1,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        scheduled_pay_date: '2026-01-15',
        gross_amount: 30000,
      });

      const call = prisma.payrollPayment.create.mock.calls[0][0];
      expect(call.data.auto_generated).toBe(false);
    });

    it('should throw 404 for non-existent employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.createManual(ctx, {
          employee_id: 9999,
          period_start: '2026-01-01',
          period_end: '2026-01-31',
          scheduled_pay_date: '2026-01-15',
          gross_amount: 1000,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const mockPayment = {
      id: 1,
      gross_amount: 30000,
      deductions: 0,
      bonuses: 0,
      net_amount: 30000,
      status: 'PENDING',
    };

    it('should recalculate net_amount on deductions change', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.payrollPayment.update.mockResolvedValue({
        ...mockPayment,
        deductions: 2000,
        net_amount: 28000,
      });

      const result = await service.update(ctx, 1, { deductions: 2000 });

      expect(result.net_amount).toBe(28000);
    });

    it('should throw 409 when updating PAID payment', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(
        service.update(ctx, 1, { deductions: 1000 }),
      ).rejects.toThrow(ConflictException);
    });

    it('should validate state transitions', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.payrollPayment.update.mockResolvedValue({
        ...mockPayment,
        status: 'CANCELLED',
      });

      const result = await service.update(ctx, 1, { status: 'CANCELLED' });
      expect(result.status).toBe('CANCELLED');
    });

    it('should reject invalid transition PAID -> PENDING', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(
        service.update(ctx, 1, { status: 'PENDING' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw 404 for non-existent payment', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(null);
      await expect(
        service.update(ctx, 9999, { deductions: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('pay', () => {
    const mockPayment = {
      id: 1,
      net_amount: 30000,
      status: 'PENDING',
      account_id: null,
      employee: { default_payment_account_id: 1 },
    };

    it('should transition to PAID', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.account.findUnique.mockResolvedValue({
        id: 1,
        is_active: true,
      });
      prisma.payrollPayment.update.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      const result = await service.pay(ctx, 1, {});

      expect(result.status).toBe('PAID');
      expect(prisma.payrollPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });

    it('should throw 409 on double pay', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(service.pay(ctx, 1, {})).rejects.toThrow(ConflictException);
    });

    it('should throw 400 when no account available', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        employee: { default_payment_account_id: null },
      });

      await expect(service.pay(ctx, 1, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw 400 for inactive account', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.account.findUnique.mockResolvedValue({
        id: 1,
        is_active: false,
      });

      await expect(service.pay(ctx, 1, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('should throw 409 when deleting PAID payment', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        id: 1,
        status: 'PAID',
      });

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
    });

    it('should delete PENDING payment', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        id: 1,
        status: 'PENDING',
      });
      prisma.payrollPayment.delete.mockResolvedValue({});

      await service.remove(ctx, 1);
      expect(prisma.payrollPayment.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw 404 for non-existent', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(null);
      await expect(service.remove(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

/*
 * Cargar la nómina de meses pasados: sin esto habría que generar y luego
 * liquidar pago a pago, y en PENDING no cuenta en el P&L —los reportes suman
 * `paid_at` con `status: PAID`—.
 */
describe('PayrollService — carga de histórico', () => {
  let service: PayrollService;
  let prisma: any;

  const empleado = {
    id: 1,
    name: 'Juan',
    pay_frequency: 'MONTHLY',
    base_salary: 30000,
    monthly_pay_day: 15,
    weekly_pay_day: null,
    biweekly_first_day: null,
    biweekly_second_day: null,
    started_at: new Date('2026-01-01'),
    ended_at: null,
    active: true,
    default_payment_account_id: null,
  };

  beforeEach(async () => {
    prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([empleado]) },
      payrollPayment: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PayrollService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
  });

  const ctx = { userId: 1, scope: 'OWN' } as any;

  it('deja pagados los periodos ya vencidos', async () => {
    const result = await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-04-30',
      already_paid: true,
    } as any);

    const rows = prisma.payrollPayment.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe('PAID');
      expect(row.paid_at).toEqual(row.scheduled_pay_date);
    }
    expect(result.paid).toBe(rows.length);
  });

  /* Un rango que cruce hoy no puede dar por liquidado lo que no ha vencido. */
  it('no da por pagado lo que todavía no vence', async () => {
    const futuro = new Date();
    futuro.setFullYear(futuro.getFullYear() + 1);

    await service.generate(ctx, {
      start_date: futuro.toISOString().slice(0, 10),
      end_date: `${futuro.getFullYear() + 1}-01-31`,
      already_paid: true,
    } as any);

    const rows = prisma.payrollPayment.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    for (const row of rows) {
      expect(row.status).toBe('PENDING');
      expect(row.paid_at).toBeNull();
    }
  });

  it('sin el flag sigue generando en PENDING', async () => {
    const result = await service.generate(ctx, {
      start_date: '2026-02-01',
      end_date: '2026-04-30',
    } as any);

    const rows = prisma.payrollPayment.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    for (const row of rows) expect(row.status).toBe('PENDING');
    expect(result.paid).toBe(0);
  });
});

/*
 * Cargar la nómina de alguien que ya no trabaja aquí. Filtrar sólo por
 * `active: true` obligaba a marcarlo como activo —mentir sobre su estado— para
 * poder registrar lo que se le pagó.
 */
describe('PayrollService — ex-empleados', () => {
  let service: PayrollService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      payrollPayment: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PayrollService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
  });

  it('incluye a quien tiene fecha de baja aunque esté inactivo', async () => {
    await service.generate(
      { userId: 1, scope: 'OWN' } as any,
      {
        start_date: '2026-01-01',
        end_date: '2026-04-30',
      } as any,
    );

    const { where } = prisma.employee.findMany.mock.calls[0][0];
    expect(where.OR).toEqual([{ active: true }, { ended_at: { not: null } }]);
  });
});

/*
 * fix-payroll-rest-ownership: toda ruta por id resuelve el pago a través del
 * propietario del empleado; ajeno = 404, y la propiedad se mira antes que el
 * estado.
 */
describe('PayrollService — propiedad por id', () => {
  let service: PayrollService;
  let prisma: any;
  const own = { userId: 1, scope: 'OWN' as const };
  const any = { userId: 1, scope: 'ANY' as const };

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      payrollPayment: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      account: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 1, is_active: true }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayrollService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PayrollService);
  });

  const calls: [string, (c: any) => Promise<unknown>][] = [
    ['findOne', (c) => service.findOne(c, 7)],
    ['update', (c) => service.update(c, 7, { deductions: 1 })],
    ['pay', (c) => service.pay(c, 7, { account_id: 1 })],
    ['remove', (c) => service.remove(c, 7)],
  ];

  it.each(calls)(
    '%s: filtra por propietario y da 404 si no es suyo',
    async (_n, call) => {
      prisma.payrollPayment.findFirst.mockResolvedValue(null);

      await expect(call(own)).rejects.toThrow(NotFoundException);

      expect(prisma.payrollPayment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7, employee: { user_id: 1 } },
        }),
      );
      expect(prisma.payrollPayment.update).not.toHaveBeenCalled();
      expect(prisma.payrollPayment.delete).not.toHaveBeenCalled();
    },
  );

  it.each(calls)(
    '%s: con ANY no restringe el pago por propietario',
    async (_n, call) => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        id: 7,
        status: 'PENDING',
        gross_amount: 1,
        deductions: 0,
        bonuses: 0,
        net_amount: 1,
        account_id: null,
        employee: { default_payment_account_id: null },
      });
      prisma.payrollPayment.update.mockResolvedValue({ id: 7 });

      await call(any);

      expect(prisma.payrollPayment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 7, employee: {} } }),
      );
    },
  );

  it('un pago ajeno PAID da 404, no 409 (propiedad antes que estado)', async () => {
    prisma.payrollPayment.findFirst.mockResolvedValue(null);
    await expect(service.remove(own, 7)).rejects.toThrow(NotFoundException);
    await expect(service.pay(own, 7, {})).rejects.toThrow(NotFoundException);
    await expect(service.update(own, 7, { status: 'PAID' })).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('pay: la cuenta es del propietario efectivo', () => {
    const pending = {
      id: 7,
      status: 'PENDING',
      net_amount: 1,
      account_id: null,
      employee: { default_payment_account_id: null },
    };

    it('cuenta ajena explícita → 400, sin pagar', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(pending);
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.pay(any, 7, { account_id: 20 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: 20, user_id: 1 },
      });
      expect(prisma.payrollPayment.update).not.toHaveBeenCalled();
    });

    it('default_payment_account_id ajeno → 400', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue({
        ...pending,
        employee: { default_payment_account_id: 20 },
      });
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.pay(any, 7, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.payrollPayment.update).not.toHaveBeenCalled();
    });

    it('con ANY y ownerUserId, la cuenta se valida contra el dueño efectivo', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(pending);
      prisma.payrollPayment.update.mockResolvedValue({ id: 7 });

      await service.pay({ userId: 9, scope: 'ANY', ownerUserId: 1 }, 7, {
        account_id: 10,
      });

      expect(prisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: 10, user_id: 1 },
      });
    });
  });

  describe('update: PAID sólo por /pay', () => {
    const pending = {
      id: 7,
      status: 'PENDING',
      gross_amount: 1000,
      deductions: 0,
      bonuses: 0,
    };

    it('status PAID → 400 y no escribe', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(pending);

      await expect(service.update(any, 7, { status: 'PAID' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.payrollPayment.update).not.toHaveBeenCalled();
    });

    it('otras transiciones siguen funcionando', async () => {
      prisma.payrollPayment.findFirst.mockResolvedValue(pending);
      prisma.payrollPayment.update.mockResolvedValue({
        ...pending,
        status: 'SKIPPED',
      });

      const r = await service.update(own, 7, { status: 'SKIPPED' });
      expect(r.status).toBe('SKIPPED');
    });

    it('UpdatePayrollPaymentDto no declara employee_id ni account_id', () => {
      const src = readFileSync(require.resolve('./dto/payroll.dto'), 'utf8');
      const block = src.slice(src.indexOf('class UpdatePayrollPaymentDto'));
      const body = block.slice(0, block.indexOf('\n}\n'));
      expect(body).not.toMatch(/employee_id|account_id/);
    });
  });

  describe('escrituras: empleado y cuenta del propietario efectivo, también con ANY', () => {
    it('generate bajo ANY consulta empleados sólo del propietario efectivo', async () => {
      await service.generate(any, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      } as any);

      const { where } = prisma.employee.findMany.mock.calls[0][0];
      expect(where.user_id).toBe(1);
    });

    it('generate usa el ownerUserId cuando se actúa en nombre de otro', async () => {
      await service.generate({ userId: 9, scope: 'ANY', ownerUserId: 1 }, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      } as any);

      expect(prisma.employee.findMany.mock.calls[0][0].where.user_id).toBe(1);
    });

    it('createManual bajo ANY filtra empleado y cuenta por el propietario efectivo', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        pay_frequency: 'MONTHLY',
      });
      prisma.payrollPayment.create.mockResolvedValue({ id: 1 });

      await service.createManual(any, {
        employee_id: 5,
        account_id: 10,
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        scheduled_pay_date: '2026-01-15',
        gross_amount: 100,
      });

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 5, user_id: 1 },
      });
      expect(prisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: 10, user_id: 1 },
      });
    });
  });
});
