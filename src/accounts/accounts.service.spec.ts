import { Test, TestingModule } from '@nestjs/testing';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

const mockAccount = {
  id: 1,
  name: 'Efectivo',
  balance: 250,
  type: 'CASH',
  credit_limit: null,
  currency: 'MXN',
  is_active: true,
  initial_balance: 250,
  user_id: 1,
  created_at: new Date('2026-01-01'),
};

const mockAccountWithCount = {
  ...mockAccount,
  _count: { incomes: 3, expenses: 5 },
};

const ctx = { userId: 1, scope: 'ANY' as const };

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      account: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      income: {
        count: jest.fn(),
      },
      expense: {
        count: jest.fn(),
      },
      expenseCategory: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  describe('findAll', () => {
    it('should return paginated accounts with defaults', async () => {
      prisma.account.findMany.mockResolvedValue([mockAccount]);
      prisma.account.count.mockResolvedValue(10);

      const result = await service.findAll(ctx, {});

      expect(result.data[0].currency).toBe('MXN');
      expect(result.data[0].is_active).toBe(true);
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prisma.account.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 20,
      });
    });

    it('should apply search filter', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      prisma.account.count.mockResolvedValue(0);

      await service.findAll(ctx, { search: 'visa' });

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: { contains: 'visa' } } }),
      );
    });

    it('should apply type filter', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      prisma.account.count.mockResolvedValue(0);

      await service.findAll(ctx, { type: 'CREDIT_CARD' });

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: 'CREDIT_CARD' } }),
      );
    });

    it('should apply sort_by and order', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      prisma.account.count.mockResolvedValue(0);

      await service.findAll(ctx, { sort_by: 'balance', order: 'desc' });

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { balance: 'desc' } }),
      );
    });

    it('should apply pagination', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      prisma.account.count.mockResolvedValue(30);

      await service.findAll(ctx, { page: 2, limit: 10 });

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('should apply combined filters', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      prisma.account.count.mockResolvedValue(0);

      await service.findAll(ctx, {
        search: 'visa',
        type: 'CREDIT_CARD',
        sort_by: 'name',
        order: 'asc',
        page: 1,
        limit: 5,
      });

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'visa' }, type: 'CREDIT_CARD' },
          orderBy: { name: 'asc' },
          skip: 0,
          take: 5,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return account with counts mapped', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccountWithCount);

      const result = await service.findOne(ctx, 1);

      expect(result).toMatchObject({
        id: 1,
        name: 'Efectivo',
        incomes_count: 3,
        expenses_count: 5,
      });
      expect(result).not.toHaveProperty('_count');
      expect(prisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          _count: {
            select: { incomes: true, expenses: true },
          },
        },
      });
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a CASH account', async () => {
      prisma.account.create.mockResolvedValue(mockAccount);

      const result = await service.create(ctx, {
        name: 'Efectivo',
        balance: 250,
        type: 'CASH',
      });

      expect(result).toMatchObject({ id: 1, name: 'Efectivo' });
    });

    it('should create a CREDIT_CARD account with limit', async () => {
      const creditAccount = {
        ...mockAccount,
        type: 'CREDIT_CARD',
        credit_limit: 2000,
      };
      prisma.account.create.mockResolvedValue(creditAccount);

      await service.create(ctx, {
        name: 'Visa',
        balance: -300,
        type: 'CREDIT_CARD',
        credit_limit: 2000,
      });

      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Visa',
            balance: -300,
            type: 'CREDIT_CARD',
            credit_limit: 2000,
          }),
        }),
      );
    });

    it('should reject CREDIT_CARD without credit_limit', async () => {
      await expect(
        service.create(ctx, {
          name: 'Visa',
          balance: 0,
          type: 'CREDIT_CARD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject CASH with credit_limit', async () => {
      await expect(
        service.create(ctx, {
          name: 'Cash',
          balance: 100,
          type: 'CASH',
          credit_limit: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow credit_limit validation to be handled by DTO layer', async () => {
      prisma.account.create.mockResolvedValue(mockAccount);

      const result = await service.create(ctx, {
        name: 'Visa',
        balance: 0,
        type: 'CREDIT_CARD',
        credit_limit: 2000,
      });

      expect(result).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update partially', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.account.update.mockResolvedValue({
        ...mockAccount,
        name: 'Nuevo',
      });

      const result = await service.update(ctx, 1, { name: 'Nuevo' });

      expect(result.name).toBe('Nuevo');
    });

    it('should reject change to CREDIT_CARD without limit on existing CASH', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);

      await expect(
        service.update(ctx, 1, { type: 'CREDIT_CARD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow change to CREDIT_CARD with limit', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.account.update.mockResolvedValue({
        ...mockAccount,
        type: 'CREDIT_CARD',
        credit_limit: 1500,
      });

      await service.update(ctx, 1, { type: 'CREDIT_CARD', credit_limit: 1500 });

      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CREDIT_CARD',
            credit_limit: 1500,
          }),
        }),
      );
    });

    it('should set credit_limit to null when changing from CREDIT_CARD', async () => {
      const creditAccount = {
        ...mockAccount,
        type: 'CREDIT_CARD' as const,
        credit_limit: 2000,
      };
      prisma.account.findFirst.mockResolvedValue(creditAccount);
      prisma.account.update.mockResolvedValue({
        ...creditAccount,
        type: 'DEBIT_CARD',
        credit_limit: null,
      });

      await service.update(ctx, 1, { type: 'DEBIT_CARD' });

      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'DEBIT_CARD',
            credit_limit: null,
          }),
        }),
      );
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.update(ctx, 9999, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete account with no transactions', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        _count: { incomes: 0, expenses: 0 },
      });
      prisma.account.delete.mockResolvedValue(mockAccount);

      const result = await service.remove(ctx, 1);

      expect(result).toMatchObject({ id: 1 });
    });

    it('should reject delete with incomes', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        _count: { incomes: 3, expenses: 0 },
      });

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
      await expect(service.remove(ctx, 1)).rejects.toThrow('3 incomes');
    });

    it('should reject delete with expenses', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        _count: { incomes: 0, expenses: 5 },
      });

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
      await expect(service.remove(ctx, 1)).rejects.toThrow('5 expenses');
    });

    it('should catch P2003 and throw ConflictException', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        _count: { incomes: 0, expenses: 0 },
      });
      const p2003Error = new Prisma.PrismaClientKnownRequestError(
        'FK constraint',
        {
          code: 'P2003',
          clientVersion: '7.0.0',
          meta: { field_name: 'account_id' },
        },
      );
      prisma.account.delete.mockRejectedValue(p2003Error);

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.remove(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('currency and activity', () => {
    it('should default currency to MXN', async () => {
      prisma.account.create.mockResolvedValue(mockAccount);

      await service.create(ctx, {
        name: 'Test',
        balance: 100,
        type: 'CASH',
      });

      const data = prisma.account.create.mock.calls[0][0].data;
      expect(data.currency).toBe('MXN');
    });

    it('should reject non-MXN currency', async () => {
      await expect(
        service.create(ctx, {
          name: 'Test',
          balance: 100,
          type: 'CASH',
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default is_active to true', async () => {
      prisma.account.create.mockResolvedValue(mockAccount);

      await service.create(ctx, {
        name: 'Test',
        balance: 100,
        type: 'CASH',
      });

      const data = prisma.account.create.mock.calls[0][0].data;
      expect(data.is_active).toBe(true);
    });

    it('should set initial_balance from balance by default', async () => {
      prisma.account.create.mockResolvedValue(mockAccount);

      await service.create(ctx, {
        name: 'Test',
        balance: 500,
        type: 'CASH',
      });

      const data = prisma.account.create.mock.calls[0][0].data;
      expect(data.initial_balance).toBe(500);
    });

    it('should filter by is_active', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      prisma.account.count.mockResolvedValue(0);

      await service.findAll(ctx, { is_active: false });

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_active: false }),
        }),
      );
    });

    it('should reject currency change on account with movements', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        currency: 'MXN',
      });
      prisma.expense.count.mockResolvedValue(3);
      prisma.income.count.mockResolvedValue(0);

      await expect(service.update(ctx, 1, { currency: 'USD' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject non-MXN currency on update', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        currency: 'MXN',
      });
      prisma.expense.count.mockResolvedValue(0);
      prisma.income.count.mockResolvedValue(0);

      await expect(service.update(ctx, 1, { currency: 'EUR' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
