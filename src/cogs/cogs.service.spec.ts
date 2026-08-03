import { Test, TestingModule } from '@nestjs/testing';
import { CogsService } from './cogs.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

const ctx = { userId: 1, scope: 'ANY' as const };

describe('CogsService', () => {
  let service: CogsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      income: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      costOfGoodsSold: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CogsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CogsService>(CogsService);
  });

  describe('create', () => {
    it('should calculate total_cost = quantity × unit_cost', async () => {
      prisma.income.findFirst.mockResolvedValue({
        id: 1,
        user_id: 1,
        net_amount: 500,
        gross_amount: 600,
      });
      prisma.costOfGoodsSold.create.mockResolvedValue({
        id: 1,
        income_id: 1,
        quantity: 5,
        unit_cost: 10,
        total_cost: 50,
      });
      prisma.costOfGoodsSold.aggregate.mockResolvedValue({
        _sum: { total_cost: 50 },
      });
      prisma.income.findUnique.mockResolvedValue({
        net_amount: 500,
        gross_amount: 600,
      });
      prisma.income.update.mockResolvedValue({});

      const result = await service.create(ctx, 1, {
        quantity: 5,
        unit_cost: 10,
      });

      expect(result.total_cost).toBe(50);
      expect(prisma.costOfGoodsSold.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            total_cost: 50,
          }),
        }),
      );
    });

    it('should update income.cogs_total after creation', async () => {
      prisma.income.findFirst.mockResolvedValue({
        id: 1,
        user_id: 1,
        net_amount: 500,
        gross_amount: 600,
      });
      prisma.costOfGoodsSold.create.mockResolvedValue({
        id: 1,
        income_id: 1,
        quantity: 3,
        unit_cost: 20,
        total_cost: 60,
      });
      prisma.costOfGoodsSold.aggregate.mockResolvedValue({
        _sum: { total_cost: 60 },
      });
      prisma.income.findUnique.mockResolvedValue({
        net_amount: 500,
        gross_amount: 600,
      });
      prisma.income.update.mockResolvedValue({});

      await service.create(ctx, 1, { quantity: 3, unit_cost: 20 });

      expect(prisma.income.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cogs_total: 60,
            profit_gross: 440,
          }),
        }),
      );
    });

    it('should reject non-positive quantity', async () => {
      prisma.income.findFirst.mockResolvedValue({
        id: 1,
        user_id: 1,
      });

      await expect(
        service.create(ctx, 1, { quantity: 0, unit_cost: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-positive unit_cost', async () => {
      prisma.income.findFirst.mockResolvedValue({
        id: 1,
        user_id: 1,
      });

      await expect(
        service.create(ctx, 1, { quantity: 5, unit_cost: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 404 if income not found', async () => {
      prisma.income.findFirst.mockResolvedValue(null);
      await expect(
        service.create(ctx, 9999, { quantity: 5, unit_cost: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should recalculate to null when all rows removed', async () => {
      prisma.costOfGoodsSold.findFirst.mockResolvedValue({
        id: 1,
        income_id: 1,
        quantity: 5,
        unit_cost: 10,
        total_cost: 50,
        income: { user_id: 1 },
      });
      prisma.costOfGoodsSold.delete.mockResolvedValue({});
      prisma.costOfGoodsSold.aggregate.mockResolvedValue({
        _sum: { total_cost: null },
      });
      prisma.income.findUnique.mockResolvedValue({
        net_amount: 500,
        gross_amount: 600,
      });
      prisma.income.update.mockResolvedValue({});

      await service.remove(ctx, 1);

      expect(prisma.income.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cogs_total: null,
            profit_gross: null,
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('should recalculate total_cost on quantity change', async () => {
      prisma.costOfGoodsSold.findFirst.mockResolvedValue({
        id: 1,
        income_id: 1,
        quantity: 5,
        unit_cost: 10,
        total_cost: 50,
        income: { user_id: 1 },
      });
      prisma.costOfGoodsSold.update.mockResolvedValue({
        id: 1,
        income_id: 1,
        quantity: 10,
        unit_cost: 10,
        total_cost: 100,
      });
      prisma.costOfGoodsSold.aggregate.mockResolvedValue({
        _sum: { total_cost: 100 },
      });
      prisma.income.findUnique.mockResolvedValue({
        net_amount: 500,
        gross_amount: 600,
      });
      prisma.income.update.mockResolvedValue({});

      const result = await service.update(ctx, 1, { quantity: 10 });

      expect(result.total_cost).toBe(100);
    });
  });
});
