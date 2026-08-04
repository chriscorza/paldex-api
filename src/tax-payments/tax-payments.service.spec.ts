import { Test, TestingModule } from '@nestjs/testing';
import { TaxPaymentsService } from './tax-payments.service';
import { PrismaService } from '../prisma.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

const ctx = { userId: 1, scope: 'ANY' as const };

describe('TaxPaymentsService', () => {
  let service: TaxPaymentsService;
  let prisma: any;

  const mockPayment = {
    id: 1,
    type: 'IVA',
    tax_id: null,
    fiscal_period_start: new Date('2026-01-01'),
    fiscal_period_end: new Date('2026-01-31'),
    due_date: null,
    paid_at: null,
    amount: 5000,
    account_id: 1,
    status: 'PENDING',
    notes: null,
    user_id: 1,
  };

  beforeEach(async () => {
    prisma = {
      taxPayment: {
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
      income: {
        aggregate: jest.fn(),
      },
      expense: {
        aggregate: jest.fn(),
      },
      tax: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxPaymentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TaxPaymentsService>(TaxPaymentsService);
  });

  describe('create', () => {
    it('should create with PENDING status when no paid_at', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 1,
        is_active: true,
      });
      prisma.taxPayment.create.mockResolvedValue({
        ...mockPayment,
        status: 'PENDING',
      });

      const result = await service.create(ctx, {
        type: 'IVA',
        fiscal_period_start: '2026-01-01',
        fiscal_period_end: '2026-01-31',
        amount: 5000,
        account_id: 1,
      });

      expect(result.status).toBe('PENDING');
    });

    it('should create with PAID status when paid_at is provided', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 1,
        is_active: true,
      });
      prisma.taxPayment.create.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      const result = await service.create(ctx, {
        type: 'ISR',
        fiscal_period_start: '2026-01-01',
        fiscal_period_end: '2026-01-31',
        paid_at: '2026-02-01',
        amount: 3000,
        account_id: 1,
      });

      expect(result.status).toBe('PAID');
    });

    it('should reject invalid period (start >= end)', async () => {
      await expect(
        service.create(ctx, {
          type: 'IVA',
          fiscal_period_start: '2026-01-31',
          fiscal_period_end: '2026-01-01',
          amount: 1000,
          account_id: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject inactive account', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 1,
        is_active: false,
      });
      await expect(
        service.create(ctx, {
          type: 'IVA',
          fiscal_period_start: '2026-01-01',
          fiscal_period_end: '2026-01-31',
          amount: 1000,
          account_id: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('pay', () => {
    it('should transition to PAID', async () => {
      prisma.taxPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.account.findFirst.mockResolvedValue({
        id: 1,
        is_active: true,
      });
      prisma.taxPayment.update.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      const result = await service.pay(ctx, 1, {});
      expect(result.status).toBe('PAID');
    });

    it('should throw 409 on double pay', async () => {
      prisma.taxPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(service.pay(ctx, 1, {})).rejects.toThrow(ConflictException);
    });

    it('should fallback to existing account_id', async () => {
      prisma.taxPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.account.findFirst.mockResolvedValue({
        id: 1,
        is_active: true,
      });
      prisma.taxPayment.update.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
        account_id: 1,
      });

      await service.pay(ctx, 1, {});
      expect(prisma.account.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });
  });

  describe('remove', () => {
    it('should throw 409 when deleting PAID payment', async () => {
      prisma.taxPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
      });

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
    });

    it('should delete PENDING payment', async () => {
      prisma.taxPayment.findFirst.mockResolvedValue(mockPayment);
      prisma.taxPayment.delete.mockResolvedValue({});

      await service.remove(ctx, 1);
      expect(prisma.taxPayment.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });

  describe('estimate', () => {
    it('should calculate IVA charged from invoiced incomes', async () => {
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 10000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { tax_creditable_amount: 0 },
      });
      prisma.tax.findFirst.mockResolvedValue(null);
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 10000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { amount: 5000 },
      });

      const result = await service.estimate(ctx, {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      });

      expect(result.iva_charged).toBe(1600); // 10000 × 0.16
    });

    it('should calculate IVA creditable from invoiced tax-deductible expenses', async () => {
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 10000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { tax_creditable_amount: 800 },
      });
      prisma.tax.findFirst.mockResolvedValue(null);
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 10000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { amount: 5000 },
      });

      const result = await service.estimate(ctx, {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      });

      expect(result.iva_creditable).toBe(800);
      expect(result.iva_to_pay).toBe(800); // 1600 - 800
    });

    it('should report iva_in_favor when creditable > charged', async () => {
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 1000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { tax_creditable_amount: 500 },
      });
      prisma.tax.findFirst.mockResolvedValue(null);
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 1000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { amount: 0 },
      });

      const result = await service.estimate(ctx, {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      });

      expect(result.iva_to_pay).toBe(0);
      expect(result.iva_in_favor).toBe(340);
    });

    it('should return null isr_estimated when ISR_ESTIMATE_PERCENTAGE is not set', async () => {
      prisma.income.aggregate.mockResolvedValueOnce({
        _sum: { net_amount: 10000 },
      });
      prisma.expense.aggregate.mockResolvedValueOnce({
        _sum: { tax_creditable_amount: 0 },
      });
      prisma.tax.findFirst.mockResolvedValue(null);

      const result = await service.estimate(ctx, {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      });

      expect(result.isr_estimated).toBeNull();
    });
  });
});
