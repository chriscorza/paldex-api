import { Test, TestingModule } from '@nestjs/testing';
import { IncomesService } from '../../incomes/incomes.service';
import { ExpensesService } from '../../expenses/expenses.service';
import { PrismaService } from '../../prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

const mockModel = (name: string) => {
  const record = {
    id: 1,
    amount: 100,
    concept: 'Test',
    date: new Date('2026-01-01'),
    invoiced: false,
    account_id: 1,
    user_id: 1,
    created_at: new Date(),
    income_type: 'OTHER',
    channel: null,
    gross_amount: 100,
    discount_total: 0,
    fee_total: 0,
    shipping_charged: 0,
    shipping_cost: 0,
    net_amount: 100,
    cogs_total: null,
    profit_gross: null,
    category_id: null,
    vendor: null,
    status: 'PAID',
    paid_at: new Date('2026-01-01'),
    invoice_status: 'NOT_INVOICED',
    invoice_uuid: null,
    supplier_rfc: null,
    subtotal: null,
    tax_amount: null,
    withholding_amount: null,
    is_tax_deductible: true,
    tax_creditable_amount: 0,
    scheduled_due_date: null,
    is_recurring: false,
    recurring_expense_id: null,
    source: null,
    external_reference: null,
    taxes: [
      {
        [`${name}_id`]: 1,
        tax_id: 1,
        tax: { id: 1, name: 'IVA', rate: 21, created_at: new Date() },
      },
    ],
    category: null,
  };
  return record;
};

const ctx = { userId: 1, scope: 'ANY' as const };

describe('Income-Expense Parity', () => {
  let incomesService: IncomesService;
  let expensesService: ExpensesService;
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
        IncomesService,
        ExpensesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    incomesService = module.get<IncomesService>(IncomesService);
    expensesService = module.get<ExpensesService>(ExpensesService);
  });

  it('should return same paginated response shape', async () => {
    const mockIncome = mockModel('income');
    const mockExpense = mockModel('expense');
    prisma.income.findMany.mockResolvedValue([mockIncome]);
    prisma.income.count.mockResolvedValue(5);
    prisma.expense.findMany.mockResolvedValue([mockExpense]);
    prisma.expense.count.mockResolvedValue(3);

    const incomeResult = await incomesService.findAll(ctx, {});
    const expenseResult = await expensesService.findAll(ctx, {});

    expect(Object.keys(incomeResult).sort()).toEqual(
      Object.keys(expenseResult).sort(),
    );
    expect(incomeResult.page).toBe(1);
    expect(expenseResult.page).toBe(1);
    expect(incomeResult.limit).toBe(20);
    expect(expenseResult.limit).toBe(20);
  });

  it('should both return 404 for missing id', async () => {
    prisma.income.findFirst.mockResolvedValue(null);
    prisma.expense.findFirst.mockResolvedValue(null);

    await expect(incomesService.findOne(ctx, 9999)).rejects.toThrow(
      NotFoundException,
    );
    await expect(expensesService.findOne(ctx, 9999)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should both validate account_id with 400', async () => {
    prisma.account.findFirst.mockResolvedValue(null);

    await expect(
      incomesService.create(ctx, {
        amount: 100,
        concept: 'T',
        date: '2026-01-01',
        invoiced: false,
        account_id: 9999,
        tax_ids: [],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      expensesService.create(ctx, {
        amount: 100,
        concept: 'T',
        date: '2026-01-01',
        invoiced: false,
        account_id: 9999,
        tax_ids: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should both handle taxes with same semantics', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, is_active: true, user_id: 1 });
    prisma.tax.count.mockResolvedValue(2);
    prisma.income.create.mockResolvedValue(mockModel('income'));
    prisma.expense.create.mockResolvedValue(mockModel('expense'));

    await incomesService.create(ctx, {
      amount: 100,
      concept: 'T',
      date: '2026-01-01',
      invoiced: false,
      account_id: 1,
      tax_ids: [1, 2],
    });
    await expensesService.create(ctx, {
      amount: 100,
      concept: 'T',
      date: '2026-01-01',
      invoiced: false,
      account_id: 1,
      tax_ids: [1, 2],
    });

    const incomeCall = prisma.income.create.mock.calls[0][0];
    const expenseCall = prisma.expense.create.mock.calls[0][0];
    expect(incomeCall.data.taxes.create).toHaveLength(2);
    expect(expenseCall.data.taxes.create).toHaveLength(2);
  });
});
