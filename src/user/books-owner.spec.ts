import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserService } from './user.service';

/* Ligar un socio a los libros del dueño (users.books_owner_id). */
describe('UserService.setBooksOwner', () => {
  const count = () => jest.fn().mockResolvedValue(0);
  let prisma: any;
  let service: UserService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn((a) => a) },
      expenseCategory: { count: count(), deleteMany: jest.fn() },
      recurringExpense: {
        count: count(),
        findMany: jest.fn().mockResolvedValue([{ category_id: 7 }]),
      },
      ...Object.fromEntries(
        [
          'expense',
          'income',
          'account',
          'employee',
          'taxPayment',
          'payable',
          'receivable',
          'fixedAsset',
          'productCost',
          'shopifyConnection',
        ].map((m) => [m, { count: count() }]),
      ),
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    service = new UserService(prisma, { invalidate: jest.fn() } as any);
  });

  const users = (map: Record<number, any>) =>
    prisma.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(map[where.id] ?? null),
    );

  it('links an empty account and drops its unused seeded categories', async () => {
    users({
      2: { id: 2, book_members: [] },
      1: { id: 1, books_owner_id: null },
    });
    await service.setBooksOwner(2, 1);
    expect(prisma.expenseCategory.deleteMany).toHaveBeenCalledWith({
      where: {
        user_id: 2,
        is_system: true,
        expenses: { none: {} },
        id: { notIn: [7] },
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { books_owner_id: 1 } }),
    );
  });

  it('refuses an account that already has its own data, saying what', async () => {
    users({
      2: { id: 2, book_members: [] },
      1: { id: 1, books_owner_id: null },
    });
    prisma.expense.count.mockResolvedValue(3);
    await expect(service.setBooksOwner(2, 1)).rejects.toThrow(/expenses: 3/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses chains and self links', async () => {
    users({ 3: { id: 3, book_members: [] }, 2: { id: 2, books_owner_id: 1 } });
    await expect(service.setBooksOwner(3, 2)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.setBooksOwner(3, 3)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses linking an owner others already work on', async () => {
    users({
      1: { id: 1, book_members: [{ id: 2 }] },
      5: { id: 5, books_owner_id: null },
    });
    await expect(service.setBooksOwner(1, 5)).rejects.toThrow(
      ConflictException,
    );
  });

  it('unlinks with null', async () => {
    users({ 2: { id: 2, book_members: [] } });
    await service.setBooksOwner(2, null);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { books_owner_id: null } }),
    );
  });
});
