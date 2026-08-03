import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

const mockExpense = {
  id: 1,
  amount: 89.9,
  concept: 'Material oficina',
  date: new Date('2026-02-10'),
  invoiced: true,
  account_id: 1,
  user_id: 1,
  category_id: null,
  vendor: null,
  status: 'PAID',
  paid_at: new Date('2026-02-10'),
  invoice_status: 'INVOICED',
  invoice_uuid: null,
  supplier_rfc: null,
  subtotal: null,
  tax_amount: null,
  withholding_amount: null,
  is_tax_deductible: true,
  tax_creditable_amount: 0,
  created_at: new Date('2026-02-10'),
  scheduled_due_date: null,
  is_recurring: false,
  recurring_expense_id: null,
  taxes: [
    {
      expense_id: 1,
      tax_id: 1,
      tax: { id: 1, name: 'IVA', rate: 21, created_at: new Date() },
    },
  ],
  category: null,
};

const mockAccount = {
  id: 1,
  name: 'Cuenta 1',
  is_active: true,
  user_id: 1,
};

const ctx = { userId: 1, scope: 'ANY' as const };

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      expense: {
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
      expenseCategory: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((queries: any[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
  });

  describe('findAll', () => {
    it('should return paginated expenses with defaults', async () => {
      prisma.expense.findMany.mockResolvedValue([mockExpense]);
      prisma.expense.count.mockResolvedValue(42);

      const result = await service.findAll(ctx, {});

      expect(result.total).toBe(42);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(1);
    });

    it('should apply date range, search, account_id and sort', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(0);

      await service.findAll(ctx, {
        start_date: '2026-02-01',
        end_date: '2026-02-28',
        search: 'oficina',
        account_id: 1,
        sort_by: 'amount',
        order: 'desc',
      });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: {
              gte: new Date('2026-02-01'),
              lte: new Date('2026-02-28'),
            },
            concept: { contains: 'oficina' },
            account_id: 1,
          }),
          orderBy: { amount: 'desc' },
        }),
      );
    });

    it('should apply pagination', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(50);

      await service.findAll(ctx, { page: 2, limit: 20 });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('should use total from count', async () => {
      prisma.expense.findMany.mockResolvedValue([mockExpense]);
      prisma.expense.count.mockResolvedValue(42);

      const result = await service.findAll(ctx, {});

      expect(result.total).toBe(42);
    });
  });

  describe('findOne', () => {
    it('should return expense with taxes', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);

      const result = await service.findOne(ctx, 1);

      expect(result.id).toBe(1);
      expect(result.amount).toBe(89.9);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      amount: 89.9,
      concept: 'Material',
      date: '2026-02-10T00:00:00.000Z',
      invoiced: true,
      account_id: 1,
      tax_ids: [1, 2],
    };

    it('should create with taxes', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(2);
      prisma.expense.create.mockResolvedValue(mockExpense);

      await service.create(ctx, createDto);

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxes: { create: [{ tax_id: 1 }, { tax_id: 2 }] },
          }),
        }),
      );
    });

    it('should reject invalid account_id', async () => {
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(service.create(ctx, createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject invalid tax_id', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(1);

      await expect(service.create(ctx, createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('should update partially', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);
      prisma.expense.update.mockResolvedValue({ ...mockExpense, amount: 120 });

      await service.update(ctx, 1, { amount: 120 });

      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 120 }),
        }),
      );
    });

    it('should replace taxes', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);
      prisma.expense.update.mockResolvedValue(mockExpense);

      await service.update(ctx, 1, { tax_ids: [2, 3] });

      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxes: { deleteMany: {}, create: [{ tax_id: 2 }, { tax_id: 3 }] },
          }),
        }),
      );
    });

    it('should empty taxes with []', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);
      prisma.expense.update.mockResolvedValue({ ...mockExpense, taxes: [] });

      await service.update(ctx, 1, { tax_ids: [] });

      const call = prisma.expense.update.mock.calls[0][0];
      expect(call.data.taxes).toEqual({ deleteMany: {}, create: [] });
    });

    it('should not touch taxes when absent', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);
      prisma.expense.update.mockResolvedValue(mockExpense);

      await service.update(ctx, 1, { concept: 'Nuevo' });

      const call = prisma.expense.update.mock.calls[0][0];
      expect(call.data.taxes).toBeUndefined();
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ctx, 9999, { amount: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete expense', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);
      prisma.expense.delete.mockResolvedValue(mockExpense);

      await service.remove(ctx, 1);

      expect(prisma.expense.delete).toHaveBeenCalledWith({
        where: { id: 1 },
        include: expect.objectContaining({
          taxes: { include: { tax: true } },
        }),
      });
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.remove(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('status defaults and coherence', () => {
    it('should default to PAID with paid_at = date', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.expense.create.mockResolvedValue(mockExpense);

      await service.create(ctx, {
        amount: 100,
        concept: 'T',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
        tax_ids: [],
      });

      const data = prisma.expense.create.mock.calls[0][0].data;
      expect(data.status).toBe('PAID');
    });

    it('should reject paid_at when status is not PAID', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);

      await expect(
        service.create(ctx, {
          amount: 100,
          concept: 'T',
          date: '2026-01-01',
          invoiced: false,
          account_id: 1,
          tax_ids: [],
          status: 'PENDING',
          paid_at: '2026-01-15',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('invoice_status derivation', () => {
    it('should derive INVOICED from invoiced=true', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.expense.create.mockResolvedValue(mockExpense);

      await service.create(ctx, {
        amount: 100,
        concept: 'T',
        date: '2026-01-01',
        invoiced: true,
        account_id: 1,
        tax_ids: [],
      });

      const data = prisma.expense.create.mock.calls[0][0].data;
      expect(data.invoice_status).toBe('INVOICED');
    });

    it('should derive NOT_INVOICED from invoiced=false', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.expense.create.mockResolvedValue(mockExpense);

      await service.create(ctx, {
        amount: 100,
        concept: 'T',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
        tax_ids: [],
      });

      const data = prisma.expense.create.mock.calls[0][0].data;
      expect(data.invoice_status).toBe('NOT_INVOICED');
    });
  });

  describe('tax_creditable_amount', () => {
    it('should be tax_amount when invoiced and deductible', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.expense.create.mockResolvedValue(mockExpense);

      await service.create(ctx, {
        amount: 1000,
        concept: 'T',
        date: '2026-01-01',
        invoiced: true,
        account_id: 1,
        tax_ids: [],
        invoice_status: 'INVOICED',
        is_tax_deductible: true,
        tax_amount: 160,
      } as any);

      const data = prisma.expense.create.mock.calls[0][0].data;
      expect(data.tax_creditable_amount).toBe(160);
    });

    it('should be 0 when not invoiced', async () => {
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.tax.count.mockResolvedValue(0);
      prisma.expense.create.mockResolvedValue(mockExpense);

      await service.create(ctx, {
        amount: 1000,
        concept: 'T',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
        tax_ids: [],
        invoice_status: 'NOT_INVOICED',
        is_tax_deductible: true,
        tax_amount: 160,
      } as any);

      const data = prisma.expense.create.mock.calls[0][0].data;
      expect(data.tax_creditable_amount).toBe(0);
    });
  });

  describe('pay', () => {
    it('should pay a PENDING expense', async () => {
      const pendingExpense = { ...mockExpense, status: 'PENDING' };
      prisma.expense.findFirst.mockResolvedValue(pendingExpense);
      prisma.account.findFirst.mockResolvedValue(mockAccount);
      prisma.expense.update.mockResolvedValue({ ...mockExpense, status: 'PAID' });

      const result = await service.pay(ctx, 1, {});
      expect(result.status).toBe('PAID');
    });

    it('should throw 409 when already PAID', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        ...mockExpense,
        status: 'PAID',
      });

      await expect(service.pay(ctx, 1, {})).rejects.toThrow(ConflictException);
    });

    it('should throw 400 for inactive account', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        ...mockExpense,
        status: 'PENDING',
        account_id: 2,
      });
      prisma.account.findFirst.mockResolvedValue({
        id: 2,
        is_active: false,
      });

      await expect(
        service.pay(ctx, 1, { account_id: 2 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('new filters', () => {
    it('should filter by category_id', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(0);

      await service.findAll(ctx, { category_id: 5 });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category_id: 5 }),
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(0);

      await service.findAll(ctx, { status: 'PENDING' as any });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('should filter by invoice_status', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(0);

      await service.findAll(ctx, { invoice_status: 'INVOICED' as any });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ invoice_status: 'INVOICED' }),
        }),
      );
    });

    it('should filter by vendor', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(0);

      await service.findAll(ctx, { vendor: 'Amazon' });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ vendor: { contains: 'Amazon' } }),
        }),
      );
    });

    it('should filter by is_tax_deductible', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.expense.count.mockResolvedValue(0);

      await service.findAll(ctx, { is_tax_deductible: false });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_tax_deductible: false }),
        }),
      );
    });
  });
});
