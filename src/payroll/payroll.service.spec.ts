import { Test, TestingModule } from '@nestjs/testing';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../prisma.service';
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
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      account: {
        findUnique: jest.fn(),
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
      prisma.payrollPayment.findUnique.mockResolvedValue(mockPayment);
      prisma.payrollPayment.update.mockResolvedValue({
        ...mockPayment,
        deductions: 2000,
        net_amount: 28000,
      });

      const result = await service.update(1, { deductions: 2000 });

      expect(result.net_amount).toBe(28000);
    });

    it('should throw 409 when updating PAID payment', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(service.update(1, { deductions: 1000 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should validate state transitions', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue(mockPayment);
      prisma.payrollPayment.update.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      const result = await service.update(1, { status: 'PAID' });
      expect(result.status).toBe('PAID');
    });

    it('should reject invalid transition PAID -> PENDING', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(service.update(1, { status: 'PENDING' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw 404 for non-existent payment', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue(null);
      await expect(service.update(9999, { deductions: 100 })).rejects.toThrow(
        NotFoundException,
      );
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
      prisma.payrollPayment.findUnique.mockResolvedValue(mockPayment);
      prisma.account.findUnique.mockResolvedValue({
        id: 1,
        is_active: true,
      });
      prisma.payrollPayment.update.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      const result = await service.pay(1, {});

      expect(result.status).toBe('PAID');
      expect(prisma.payrollPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });

    it('should throw 409 on double pay', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(service.pay(1, {})).rejects.toThrow(ConflictException);
    });

    it('should throw 400 when no account available', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue({
        ...mockPayment,
        employee: { default_payment_account_id: null },
      });

      await expect(service.pay(1, {})).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 for inactive account', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue(mockPayment);
      prisma.account.findUnique.mockResolvedValue({
        id: 1,
        is_active: false,
      });

      await expect(service.pay(1, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should throw 409 when deleting PAID payment', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue({
        id: 1,
        status: 'PAID',
      });

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
    });

    it('should delete PENDING payment', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue({
        id: 1,
        status: 'PENDING',
      });
      prisma.payrollPayment.delete.mockResolvedValue({});

      await service.remove(1);
      expect(prisma.payrollPayment.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw 404 for non-existent', async () => {
      prisma.payrollPayment.findUnique.mockResolvedValue(null);
      await expect(service.remove(9999)).rejects.toThrow(NotFoundException);
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
