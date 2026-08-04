import { Test, TestingModule } from '@nestjs/testing';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../prisma.service';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

const ctx = { userId: 1, scope: 'ANY' as const };

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;

  const mockEmployee = {
    id: 1,
    name: 'Juan',
    position: 'Developer',
    salary_type: 'SALARIED',
    pay_frequency: 'MONTHLY',
    base_salary: 30000,
    weekly_pay_day: null,
    biweekly_first_day: null,
    biweekly_second_day: null,
    monthly_pay_day: 15,
    default_payment_account_id: null,
    started_at: new Date('2026-01-01'),
    ended_at: null,
    active: true,
    user_id: 1,
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      account: {
        findFirst: jest.fn(),
      },
      payrollPayment: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  describe('create - frequency validation', () => {
    const baseDto = {
      name: 'Juan',
      pay_frequency: 'MONTHLY' as const,
      base_salary: 30000,
      monthly_pay_day: 15,
    };

    it('should create employee with valid MONTHLY config', async () => {
      prisma.employee.create.mockResolvedValue(mockEmployee);

      const result = await service.create(ctx, baseDto as any);
      expect(result.id).toBe(1);
    });

    it('should reject WEEKLY without weekly_pay_day', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'WEEKLY',
          monthly_pay_day: undefined,
          weekly_pay_day: undefined,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject BIWEEKLY without both days', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'BIWEEKLY',
          monthly_pay_day: undefined,
          biweekly_first_day: 15,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject MONTHLY without monthly_pay_day', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          monthly_pay_day: undefined,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject WEEKLY with monthly_pay_day set', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'WEEKLY',
          weekly_pay_day: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject BIWEEKLY with weekly_pay_day set', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'BIWEEKLY',
          monthly_pay_day: undefined,
          biweekly_first_day: 15,
          biweekly_second_day: 30,
          weekly_pay_day: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject MONTHLY with weekly_pay_day set', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          weekly_pay_day: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid weekly_pay_day range', async () => {
      await expect(
        service.create(ctx, {
          name: 'Juan',
          pay_frequency: 'WEEKLY',
          base_salary: 1000,
          weekly_pay_day: 8,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject biweekly days that are the same', async () => {
      await expect(
        service.create(ctx, {
          name: 'Juan',
          pay_frequency: 'BIWEEKLY',
          base_salary: 1000,
          biweekly_first_day: 15,
          biweekly_second_day: 15,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid monthly_pay_day range', async () => {
      await expect(
        service.create(ctx, {
          name: 'Juan',
          pay_frequency: 'MONTHLY',
          base_salary: 1000,
          monthly_pay_day: 32,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject inactive payment account', async () => {
      (prisma.account.findFirst as jest.Mock).mockResolvedValue({
        id: 99,
        is_active: false,
      });

      await expect(
        service.create(ctx, {
          ...baseDto,
          default_payment_account_id: 99,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove - deactivation vs delete', () => {
    it('should throw 409 when employee has payroll payments', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 1, active: true });
      prisma.payrollPayment.count.mockResolvedValue(3);

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
    });

    it('should delete employee with no payments', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 1, active: true });
      prisma.payrollPayment.count.mockResolvedValue(0);
      prisma.employee.delete.mockResolvedValue({});

      await service.remove(ctx, 1);
      expect(prisma.employee.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundException', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.remove(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findPayments', () => {
    it('should return payments for employee', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 1 });
      prisma.payrollPayment.findMany.mockResolvedValue([
        { id: 1, net_amount: 30000, status: 'PAID' },
      ]);

      const result = await service.findPayments(ctx, 1);
      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException for non-existent employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.findPayments(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
