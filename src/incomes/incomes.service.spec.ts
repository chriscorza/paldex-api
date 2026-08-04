import { Test, TestingModule } from '@nestjs/testing';
import { IncomesService } from './incomes.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const mockIncome = {
  id: 1,
  amount: 1500.5,
  concept: 'Factura enero',
  date: new Date('2026-01-31'),
  invoiced: true,
  account_id: 1,
  created_at: new Date('2026-01-31'),
  user_id: 1,
  source: null,
  external_reference: null,
  income_type: 'OTHER',
  channel: null,
  gross_amount: 1500.5,
  discount_total: 0,
  fee_total: 0,
  shipping_charged: 0,
  shipping_cost: 0,
  net_amount: 1500.5,
  cogs_total: null,
  profit_gross: null,
  taxes: [
    {
      income_id: 1,
      tax_id: 1,
      tax: { id: 1, name: 'IVA', rate: 21, created_at: new Date() },
    },
  ],
};

const mockAccount = {
  id: 1,
  name: 'Cuenta 1',
  is_active: true,
  user_id: 1,
};

const ctx = { userId: 1, scope: 'ANY' as const };

describe('IncomesService', () => {
  let service: IncomesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      income: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      account: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      tax: {
        count: jest.fn(),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [IncomesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<IncomesService>(IncomesService);
  });

  describe('findAll', () => {
    it('should return paginated incomes with taxes', async () => {
      prisma.income.findMany.mockResolvedValue([mockIncome]);
      prisma.income.count.mockResolvedValue(42);

      const result = await service.findAll(ctx, {});

      expect(result.total).toBe(42);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(1);
      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { date: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.income.count).toHaveBeenCalledWith({ where: {} });
    });

    it('should apply date range filters', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      });

      const expectedWhere = {
        date: {
          gte: new Date('2026-01-01'),
          lte: new Date('2026-01-31'),
        },
      };
      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('should apply only start_date filter', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { start_date: '2026-01-01' });

      const expectedWhere = {
        date: { gte: new Date('2026-01-01') },
      };
      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('should apply search filter', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { search: 'factura' });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { concept: { contains: 'factura' } },
        }),
      );
    });

    it('should apply account_id filter', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { account_id: 2 });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { account_id: 2 },
        }),
      );
    });

    it('should apply sort_by and order', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { sort_by: 'amount', order: 'asc' });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { amount: 'asc' } }),
      );
    });

    it('should use defaults when no sort params provided', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, {});

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { date: 'desc' } }),
      );
    });

    it('should apply pagination with skip and take', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(50);

      await service.findAll(ctx, { page: 2, limit: 20 });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(prisma.income.count).toHaveBeenCalledWith({ where: {} });
    });

    it('should use total from count, not data length', async () => {
      prisma.income.findMany.mockResolvedValue([mockIncome]);
      prisma.income.count.mockResolvedValue(42);

      const result = await service.findAll(ctx, {});

      expect(result.total).toBe(42);
    });

    it('should apply combined filters', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, {
        start_date: '2026-01-01',
        search: 'factura',
        sort_by: 'date',
        order: 'asc',
        page: 1,
        limit: 10,
      });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            date: { gte: new Date('2026-01-01') },
            concept: { contains: 'factura' },
          },
          orderBy: { date: 'asc' },
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an income with taxes', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);

      const result = await service.findOne(ctx, 1);

      expect(result.id).toBe(1);
      expect(prisma.income.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it('should throw NotFoundException if income does not exist', async () => {
      prisma.income.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      amount: 1500.5,
      concept: 'Factura',
      date: '2026-01-31T00:00:00.000Z',
      invoiced: true,
      account_id: 1,
      tax_ids: [1, 2],
    };

    it('should create an income with taxes', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(2);
      prisma.income.create.mockResolvedValue(mockIncome);

      const result = await service.create(ctx, createDto);

      expect(result.id).toBe(1);
      expect(prisma.income.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 1500.5,
            taxes: {
              create: [{ tax_id: 1 }, { tax_id: 2 }],
            },
          }),
        }),
      );
    });

    it('should create income without taxes when tax_ids is empty', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.income.create.mockResolvedValue({ ...mockIncome, taxes: [] });

      await service.create(ctx, { ...createDto, tax_ids: [] });

      expect(prisma.income.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxes: undefined }),
        }),
      );
    });

    it('should throw BadRequestException for invalid account_id', async () => {
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.create(ctx, createDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(ctx, createDto)).rejects.toThrow(
        'Account with id 1 does not exist',
      );
    });

    it('should throw BadRequestException for invalid tax_id', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(1);

      await expect(service.create(ctx, createDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(ctx, createDto)).rejects.toThrow(
        'One or more tax_ids do not exist',
      );
    });

    it('should catch P2003 and throw BadRequestException', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(2);
      const p2003Error = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        {
          code: 'P2003',
          clientVersion: '7.0.0',
          meta: { field_name: 'account_id' },
        },
      );
      prisma.income.create.mockRejectedValue(p2003Error);

      await expect(service.create(ctx, createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('should update an income partially', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);
      prisma.income.update.mockResolvedValue({
        ...mockIncome,
        amount: 2000,
      });

      const result = await service.update(ctx, 1, { amount: 2000 });

      expect(result.amount).toBe(2000);
      expect(prisma.income.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 2000 }),
        }),
      );
    });

    it('should throw NotFoundException if income does not exist', async () => {
      prisma.income.findFirst.mockResolvedValue(null);

      await expect(service.update(ctx, 9999, { amount: 2000 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should replace taxes when tax_ids is provided', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);
      prisma.income.update.mockResolvedValue(mockIncome);

      await service.update(ctx, 1, { tax_ids: [2, 3] });

      expect(prisma.income.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxes: {
              deleteMany: {},
              create: [{ tax_id: 2 }, { tax_id: 3 }],
            },
          }),
        }),
      );
    });

    it('should empty taxes when tax_ids is empty array', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);
      prisma.income.update.mockResolvedValue({ ...mockIncome, taxes: [] });

      await service.update(ctx, 1, { tax_ids: [] });

      expect(prisma.income.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxes: { deleteMany: {}, create: [] },
          }),
        }),
      );
    });

    it('should not touch taxes when tax_ids is absent', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);
      prisma.income.update.mockResolvedValue(mockIncome);

      await service.update(ctx, 1, { concept: 'Nuevo' });

      const updateCall = prisma.income.update.mock.calls[0][0];
      expect(updateCall.data.taxes).toBeUndefined();
    });

    it('should validate account_id in update', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ctx, 1, { account_id: 9999 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should delete an income', async () => {
      prisma.income.findFirst.mockResolvedValue(mockIncome);
      prisma.income.delete.mockResolvedValue(mockIncome);

      const result = await service.remove(ctx, 1);

      expect(result.id).toBe(1);
      expect(prisma.income.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it('should throw NotFoundException if income does not exist', async () => {
      prisma.income.findFirst.mockResolvedValue(null);

      await expect(service.remove(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('breakdown calculation', () => {
    it('should set gross_amount = net_amount = amount when no breakdown', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.income.create.mockResolvedValue(mockIncome);

      await service.create(ctx, {
        amount: 1500,
        concept: 'Test',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
        tax_ids: [],
      });

      const data = prisma.income.create.mock.calls[0][0].data;
      expect(data.gross_amount).toBe(1500);
      expect(data.net_amount).toBe(1500);
    });

    it('should calculate net_amount from breakdown', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.income.create.mockResolvedValue(mockIncome);

      await service.create(ctx, {
        amount: 2000,
        concept: 'Test',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
        tax_ids: [],
        gross_amount: 2000,
        discount_total: 200,
        fee_total: 50,
        shipping_charged: 100,
        shipping_cost: 80,
      } as any);

      const data = prisma.income.create.mock.calls[0][0].data;
      expect(data.gross_amount).toBe(2000);
      expect(data.net_amount).toBe(1670); // 2000 - 200 - 50 - 80
    });

    it('should default income_type to OTHER', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.income.create.mockResolvedValue(mockIncome);

      await service.create(ctx, {
        amount: 100,
        concept: 'T',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
        tax_ids: [],
      });

      const data = prisma.income.create.mock.calls[0][0].data;
      expect(data.income_type).toBe('OTHER');
    });
  });

  describe('new filters', () => {
    it('should filter by income_type', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { income_type: 'SALES' as any });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ income_type: 'SALES' }),
        }),
      );
    });

    it('should filter by channel', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { channel: 'online' });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ channel: 'online' }),
        }),
      );
    });

    it('should filter has_cogs = true', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { has_cogs: true });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cogs_total: { not: null } }),
        }),
      );
    });

    it('should filter has_cogs = false', async () => {
      prisma.income.findMany.mockResolvedValue([]);
      prisma.income.count.mockResolvedValue(0);

      await service.findAll(ctx, { has_cogs: false });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cogs_total: null }),
        }),
      );
    });
  });
});
