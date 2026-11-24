import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountTransfersService } from './account-transfers.service';
import { PrismaService } from '../prisma.service';
import { CloseGuard } from '../monthly-close/close-guard';
import { OwnershipContext } from '../common/ownership';
import { startOfDayInZone } from '../common/timezone';

const Decimal = Prisma.Decimal;

describe('AccountTransfersService', () => {
  const own: OwnershipContext = { userId: 1, scope: 'OWN' };
  /* El asistente: autoriza como 9, escribe en los libros de 1. */
  const agent: OwnershipContext = { userId: 9, scope: 'OWN', ownerUserId: 1 };

  const accounts = [
    { id: 1, name: 'BBVA', user_id: 1 },
    { id: 3, name: 'Mercado Pago', user_id: 1 },
    { id: 7, name: 'Cuenta ajena', user_id: 2 },
  ];

  const transferRow = (overrides: Record<string, unknown> = {}) => ({
    id: 40,
    from_account_id: 3,
    to_account_id: 1,
    amount: new Decimal(50000),
    date: startOfDayInZone('2027-01-15'),
    fee_amount: new Decimal(0),
    fee_expense_id: null,
    fee_expense: null,
    notes: null,
    user_id: 1,
    created_by: 1,
    creator: null,
    from_account: { id: 3, name: 'Mercado Pago' },
    to_account: { id: 1, name: 'BBVA' },
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  let prisma: any;
  let closeGuard: { ensureOpen: jest.Mock };
  let service: AccountTransfersService;
  let nextExpenseId: number;

  beforeEach(() => {
    nextExpenseId = 500;
    prisma = {
      account: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            accounts.filter(
              (a) => where.id.in.includes(a.id) && a.user_id === where.user_id,
            ),
          ),
        ),
      },
      expenseCategory: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === 6
              ? { id: 6, type: 'SHOPIFY_FEES' }
              : where.id === 99
                ? { id: 99, type: 'PAYROLL' }
                : null,
          ),
        ),
      },
      expense: {
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: nextExpenseId++, ...data }),
        ),
        update: jest.fn(({ where, data }) =>
          Promise.resolve({ id: where.id, ...data }),
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accountTransfer: {
        create: jest.fn(({ data }) =>
          Promise.resolve(
            transferRow({
              ...data,
              fee_expense: data.fee_expense_id ? { category_id: 6 } : null,
            }),
          ),
        ),
        update: jest.fn(({ data }) => Promise.resolve(transferRow(data))),
        delete: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    closeGuard = { ensureOpen: jest.fn().mockResolvedValue(undefined) };
    service = new AccountTransfersService(
      prisma as PrismaService,
      closeGuard as unknown as CloseGuard,
    );
  });

  const base = {
    from_account_id: 3,
    to_account_id: 1,
    amount: 50000,
    date: '2027-01-15',
  };

  describe('create', () => {
    it('ancla la fecha a la medianoche del negocio y no crea gasto sin comisión', async () => {
      const result = await service.create(own, {
        ...base,
        date: '2027-01-01T00:00:00.000Z',
      });

      const data = prisma.accountTransfer.create.mock.calls[0][0].data;
      expect(data.date).toEqual(startOfDayInZone('2027-01-01'));
      expect(data.fee_expense_id).toBeNull();
      expect(data.user_id).toBe(1);
      expect(prisma.expense.create).not.toHaveBeenCalled();
      expect(result.amount).toBe(50000);
      expect(closeGuard.ensureOpen).toHaveBeenCalledWith(
        1,
        startOfDayInZone('2027-01-01'),
      );
    });

    it('rechaza origen igual a destino', async () => {
      await expect(
        service.create(own, { ...base, to_account_id: 3 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza una cuenta de otro dueño como si no existiera', async () => {
      await expect(
        service.create(own, { ...base, to_account_id: 7 }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.create(
          { userId: 1, scope: 'ANY' },
          { ...base, to_account_id: 7 },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.accountTransfer.create).not.toHaveBeenCalled();
    });

    it('registra la comisión como gasto pagado desde la cuenta origen', async () => {
      const result = await service.create(agent, {
        ...base,
        fee_amount: 35,
        fee_category_id: 6,
      });

      const expense = prisma.expense.create.mock.calls[0][0].data;
      expect(expense).toMatchObject({
        account_id: 3,
        category_id: 6,
        status: 'PAID',
        user_id: 1,
        created_by: 9,
      });
      expect(expense.amount).toEqual(new Decimal(35));
      expect(expense.paid_at).toEqual(startOfDayInZone('2027-01-15'));
      expect(expense.concept).toContain('Mercado Pago');

      const data = prisma.accountTransfer.create.mock.calls[0][0].data;
      expect(data.fee_expense_id).toBe(500);
      expect(data.user_id).toBe(1);
      expect(data.created_by).toBe(9);
      expect(result.fee_category_id).toBe(6);
    });

    it('exige categoría para la comisión y rechaza la de nómina', async () => {
      await expect(
        service.create(own, { ...base, fee_amount: 35 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(own, { ...base, fee_amount: 35, fee_category_id: 99 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(own, { ...base, fee_amount: 35, fee_category_id: 123 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('no escribe nada en un mes cerrado', async () => {
      closeGuard.ensureOpen.mockRejectedValue(
        new ConflictException('Cannot modify data in closed month 2027-01'),
      );
      await expect(service.create(own, base)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('actualiza el gasto de la comisión con la nueva fecha y cuenta', async () => {
      prisma.accountTransfer.findFirst.mockResolvedValue(
        transferRow({
          fee_amount: new Decimal(35),
          fee_expense_id: 500,
          fee_expense: { category_id: 6 },
        }),
      );

      await service.update(own, 40, { date: '2027-01-20', fee_amount: 40 });

      const call = prisma.expense.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 500 });
      expect(call.data.amount).toEqual(new Decimal(40));
      expect(call.data.paid_at).toEqual(startOfDayInZone('2027-01-20'));
      expect(call.data.category_id).toBe(6);
      expect(call.data).not.toHaveProperty('created_by');
      expect(closeGuard.ensureOpen).toHaveBeenCalledTimes(2);
    });

    it('borra el gasto de la comisión cuando queda en cero', async () => {
      prisma.accountTransfer.findFirst.mockResolvedValue(
        transferRow({
          fee_amount: new Decimal(35),
          fee_expense_id: 500,
          fee_expense: { category_id: 6 },
        }),
      );

      await service.update(own, 40, { fee_amount: 0 });

      expect(
        prisma.accountTransfer.update.mock.calls[0][0].data.fee_expense_id,
      ).toBeNull();
      expect(prisma.expense.deleteMany).toHaveBeenCalledWith({
        where: { id: 500 },
      });
    });

    it('crea el gasto si se agrega una comisión que no había', async () => {
      prisma.accountTransfer.findFirst.mockResolvedValue(transferRow());

      await service.update(own, 40, { fee_amount: 20, fee_category_id: 6 });

      expect(prisma.expense.create).toHaveBeenCalled();
      expect(
        prisma.accountTransfer.update.mock.calls[0][0].data.fee_expense_id,
      ).toBe(500);
    });

    it('no encuentra el traspaso de otro dueño', async () => {
      prisma.accountTransfer.findFirst.mockResolvedValue(null);
      await expect(service.update(own, 40, { amount: 1 })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.accountTransfer.findFirst.mock.calls[0][0].where).toEqual({
        id: 40,
        user_id: 1,
      });
    });
  });

  describe('remove', () => {
    it('borra el traspaso y el gasto de su comisión', async () => {
      prisma.accountTransfer.findFirst.mockResolvedValue(
        transferRow({ fee_expense_id: 500, fee_amount: new Decimal(35) }),
      );

      await expect(service.remove(own, 40)).resolves.toEqual({ id: 40 });

      expect(prisma.accountTransfer.delete).toHaveBeenCalledWith({
        where: { id: 40 },
      });
      expect(prisma.expense.deleteMany).toHaveBeenCalledWith({
        where: { id: 500 },
      });
    });

    it('respeta el cierre mensual', async () => {
      prisma.accountTransfer.findFirst.mockResolvedValue(transferRow());
      closeGuard.ensureOpen.mockRejectedValue(new ConflictException('closed'));
      await expect(service.remove(own, 40)).rejects.toThrow(ConflictException);
      expect(prisma.accountTransfer.delete).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filtra por cuenta en origen o destino y por días del negocio', async () => {
      await service.findAll(own, {
        account_id: 3,
        start_date: '2027-01-01',
        end_date: '2027-01-31',
      });

      const where = prisma.accountTransfer.findMany.mock.calls[0][0].where;
      expect(where.user_id).toBe(1);
      expect(where.OR).toEqual([{ from_account_id: 3 }, { to_account_id: 3 }]);
      expect(where.date.gte).toEqual(startOfDayInZone('2027-01-01'));
      expect(where.date.lte.getTime()).toBeGreaterThan(
        startOfDayInZone('2027-01-31').getTime(),
      );
    });
  });
});
