import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExpensesService } from '../expenses/expenses.service';
import { RecurringExpensesService } from '../recurring-expenses/recurring-expenses.service';
import { CloseGuard } from '../monthly-close/close-guard';
import { PrismaService } from '../prisma.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { assertCategoryNotPayroll } from './payroll-category.guard';

/*
 * PayrollPayment es el único registro del dinero pagado a empleados: un gasto
 * (directo, editado o por plantilla recurrente) con categoría PAYROLL se
 * rechaza, y una categoría normal NO (el guard no es un rechazo en bloque).
 */
describe('PAYROLL-typed expense categories are refused', () => {
  const ctx = { userId: 1, scope: 'OWN' } as const;

  describe('assertCategoryNotPayroll', () => {
    it('rechaza PAYROLL con 400 y apunta a los endpoints de nómina', () => {
      expect(() => assertCategoryNotPayroll({ type: 'PAYROLL' })).toThrow(
        BadRequestException,
      );
      expect(() => assertCategoryNotPayroll({ type: 'PAYROLL' })).toThrow(
        /POST \/payroll.*\/payroll\/:id\/pay/,
      );
    });

    it('deja pasar cualquier otro tipo, sin categoría o desconocida', () => {
      for (const type of [
        'OPERATING',
        'COGS',
        'TAX',
        'OWNER',
        'DEBT',
        'OTHER',
      ]) {
        expect(() => assertCategoryNotPayroll({ type })).not.toThrow();
      }
      expect(() => assertCategoryNotPayroll(null)).not.toThrow();
      expect(() => assertCategoryNotPayroll(undefined)).not.toThrow();
    });
  });

  describe('ExpensesService', () => {
    let service: ExpensesService;
    let prisma: any;
    const dto = {
      amount: 10,
      concept: 'x',
      date: '2026-02-10T00:00:00.000Z',
      invoiced: false,
      account_id: 1,
      category_id: 7,
    };

    beforeEach(async () => {
      prisma = {
        expense: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            status: 'PAID',
            paid_at: new Date('2026-02-10'),
            invoiced: false,
            invoice_status: 'NOT_INVOICED',
            is_tax_deductible: true,
            tax_amount: null,
            category_id: 2,
          }),
          create: jest.fn().mockResolvedValue({ id: 1, taxes: [] }),
          update: jest.fn().mockResolvedValue({ id: 1, taxes: [] }),
        },
        account: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
        tax: { count: jest.fn() },
        expenseCategory: { findFirst: jest.fn() },
      };
      const module = await Test.createTestingModule({
        providers: [
          ExpensesService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      service = module.get(ExpensesService);
    });

    it('create con categoría PAYROLL → 400 y no se crea nada', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 7,
        type: 'PAYROLL',
      });

      await expect(service.create(ctx, dto)).rejects.toThrow(/POST \/payroll/);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('create con categoría OPERATING sigue funcionando', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 7,
        type: 'OPERATING',
      });

      await service.create(ctx, dto);

      expect(prisma.expense.create).toHaveBeenCalled();
    });

    it('create sin categoría sigue funcionando', async () => {
      await service.create(ctx, { ...dto, category_id: undefined });

      expect(prisma.expense.create).toHaveBeenCalled();
    });

    it('update hacia una categoría PAYROLL → 400, conserva la anterior (aun sin account_id)', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 7,
        type: 'PAYROLL',
      });

      await expect(service.update(ctx, 1, { category_id: 7 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });

    it('update hacia una categoría normal funciona', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 7,
        type: 'OPERATING',
      });

      await service.update(ctx, 1, { category_id: 7 });

      expect(prisma.expense.update).toHaveBeenCalled();
    });

    it('update que no toca la categoría no consulta ni rechaza nada', async () => {
      await service.update(ctx, 1, { amount: 5 });

      expect(prisma.expenseCategory.findFirst).not.toHaveBeenCalled();
      expect(prisma.expense.update).toHaveBeenCalled();
    });
  });

  describe('RecurringExpensesService', () => {
    let service: RecurringExpensesService;
    let prisma: any;
    const dto = {
      concept: 'Nómina',
      amount: 100,
      category_id: 7,
      frequency: 'MONTHLY' as any,
    };

    beforeEach(async () => {
      prisma = {
        expenseCategory: { findUnique: jest.fn() },
        recurringExpense: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        },
      };
      const module = await Test.createTestingModule({
        providers: [
          RecurringExpensesService,
          { provide: PrismaService, useValue: prisma },
          { provide: CloseGuard, useValue: { ensureOpen: jest.fn() } },
        ],
      }).compile();
      service = module.get(RecurringExpensesService);
    });

    it('create con categoría PAYROLL → 400, sin plantilla', async () => {
      prisma.expenseCategory.findUnique.mockResolvedValue({ type: 'PAYROLL' });

      await expect(service.create(ctx, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('update hacia PAYROLL → 400', async () => {
      prisma.expenseCategory.findUnique.mockResolvedValue({ type: 'PAYROLL' });

      await expect(service.update(ctx, 1, { category_id: 7 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringExpense.update).not.toHaveBeenCalled();
    });

    it('una categoría OPERATING sigue pasando', async () => {
      prisma.expenseCategory.findUnique.mockResolvedValue({
        type: 'OPERATING',
      });

      await service.create(ctx, dto);

      expect(prisma.recurringExpense.create).toHaveBeenCalled();
    });
  });

  describe('seed', () => {
    it('ninguna cuenta se siembra con una categoría PAYROLL', async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const module = await Test.createTestingModule({
        providers: [
          ExpenseCategoriesService,
          {
            provide: PrismaService,
            useValue: { expenseCategory: { upsert } },
          },
        ],
      }).compile();

      await module.get(ExpenseCategoriesService).seedSystemCategories(1);

      expect(upsert).toHaveBeenCalled();
      const types = upsert.mock.calls.map((c) => c[0].create.type);
      expect(types).not.toContain('PAYROLL');
      const names = upsert.mock.calls.map((c) => c[0].create.name);
      expect(names).not.toContain('Nómina (manual)');
    });
  });
});
