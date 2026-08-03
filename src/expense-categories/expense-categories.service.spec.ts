import { Test, TestingModule } from '@nestjs/testing';
import { ExpenseCategoriesService } from './expense-categories.service';
import { PrismaService } from '../prisma.service';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

const ctx = { userId: 1, scope: 'ANY' as const };

describe('ExpenseCategoriesService', () => {
  let service: ExpenseCategoriesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      expenseCategory: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
      },
      expense: {
        count: jest.fn(),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseCategoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ExpenseCategoriesService>(ExpenseCategoriesService);
  });

  describe('seedSystemCategories', () => {
    it('should upsert 17 system categories', async () => {
      prisma.expenseCategory.upsert.mockResolvedValue({ id: 1 });

      await service.seedSystemCategories(1);

      expect(prisma.expenseCategory.upsert).toHaveBeenCalledTimes(17);
    });

    it('should be idempotent (upsert, not insert)', async () => {
      prisma.expenseCategory.upsert.mockResolvedValue({ id: 1 });

      await service.seedSystemCategories(1);
      await service.seedSystemCategories(1);

      expect(prisma.expenseCategory.upsert).toHaveBeenCalledTimes(34);
    });

    it('should set is_system: true for all categories', async () => {
      prisma.expenseCategory.upsert.mockResolvedValue({ id: 1 });

      await service.seedSystemCategories(1);

      for (const call of prisma.expenseCategory.upsert.mock.calls) {
        expect(call[0].create.is_system).toBe(true);
      }
    });
  });

  describe('create', () => {
    it('should create a custom category with default flags', async () => {
      prisma.expenseCategory.create.mockResolvedValue({
        id: 2,
        name: 'Custom',
        type: 'OPERATING',
        is_system: false,
        affects_gross_profit: false,
        affects_operating_profit: true,
        is_cash_outflow: true,
      });

      const result = await service.create(ctx, {
        name: 'Custom',
        type: 'OPERATING',
      });

      expect(result.is_system).toBe(false);
      expect(result.affects_operating_profit).toBe(true);
    });

    it('should reject duplicate name+type with 409', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
      });
      prisma.expenseCategory.create.mockRejectedValue(p2002Error);

      await expect(
        service.create(ctx, { name: 'Dup', type: 'OPERATING' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should block update of system categories', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 1,
        name: 'Renta local',
        type: 'OPERATING',
        is_system: true,
      });

      await expect(
        service.update(ctx, 1, { name: 'Changed' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow update of custom categories', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 2,
        name: 'Custom',
        type: 'OPERATING',
        is_system: false,
      });
      prisma.expenseCategory.update.mockResolvedValue({
        id: 2,
        name: 'Updated',
        type: 'OPERATING',
        is_system: false,
      });

      const result = await service.update(ctx, 2, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should block delete of system categories', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 1,
        name: 'Renta local',
        is_system: true,
      });

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
    });

    it('should block delete with associated expenses', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 2,
        name: 'Custom',
        is_system: false,
      });
      prisma.expense.count.mockResolvedValue(5);

      await expect(service.remove(ctx, 2)).rejects.toThrow(ConflictException);
    });

    it('should delete category with no expenses', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 2,
        name: 'Custom',
        is_system: false,
      });
      prisma.expense.count.mockResolvedValue(0);
      prisma.expenseCategory.delete.mockResolvedValue({ id: 2 });

      await service.remove(ctx, 2);
      expect(prisma.expenseCategory.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 2 } }),
      );
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue(null);
      await expect(service.findOne(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
