import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FixedAssetsService } from './fixed-assets.service';
import { PrismaService } from '../prisma.service';
import { OwnershipContext } from '../common/ownership';

const Decimal = Prisma.Decimal;

describe('FixedAssetsService', () => {
  const own: OwnershipContext = { userId: 1, scope: 'OWN' };

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 5,
    name: 'Laptop',
    kind: 'TANGIBLE',
    asset_class: 'COMPUTER',
    acquisition_cost: new Decimal(12000),
    acquired_at: new Date('2026-03-08T06:00:00Z'),
    in_service_at: new Date('2026-03-10T06:00:00Z'),
    useful_life_months: 12,
    salvage_value: new Decimal(0),
    disposed_at: null,
    disposal_amount: null,
    expense_id: null,
    notes: null,
    user_id: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  let prisma: any;
  let service: FixedAssetsService;

  beforeEach(() => {
    prisma = {
      fixedAsset: {
        create: jest.fn(({ data }) => Promise.resolve(row({ ...data }))),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(({ data }) => Promise.resolve(row({ ...data }))),
        delete: jest.fn(),
      },
      expense: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new FixedAssetsService(prisma as PrismaService);
  });

  const base = {
    name: 'Laptop',
    asset_class: 'COMPUTER' as const,
    acquisition_cost: 30000,
    acquired_at: '2026-03-08',
    in_service_at: '2026-03-10',
  };

  it('propone la vida útil y el kind de la clase', async () => {
    await service.create(own, base);

    const data = prisma.fixedAsset.create.mock.calls[0][0].data;
    expect(data.useful_life_months).toBe(40);
    expect(data.kind).toBe('TANGIBLE');
    expect(data.user_id).toBe(1);
    expect(Number(data.salvage_value)).toBe(0);
  });

  it('toma la fecha de calendario aunque llegue con hora UTC', async () => {
    await service.create(own, {
      ...base,
      acquired_at: '2026-04-01T00:00:00.000Z',
      in_service_at: '2026-04-01T00:00:00.000Z',
    });

    const data = prisma.fixedAsset.create.mock.calls[0][0].data;
    /* Medianoche del 1 de abril en CDMX, no las 18:00 del 31 de marzo. */
    expect(data.in_service_at.toISOString()).toBe('2026-04-01T06:00:00.000Z');
  });

  it('respeta la vida útil indicada', async () => {
    await service.create(own, { ...base, useful_life_months: 24 });

    expect(
      prisma.fixedAsset.create.mock.calls[0][0].data.useful_life_months,
    ).toBe(24);
  });

  it('el software es intangible por omisión', async () => {
    await service.create(own, { ...base, asset_class: 'SOFTWARE' });

    expect(prisma.fixedAsset.create.mock.calls[0][0].data.kind).toBe(
      'INTANGIBLE',
    );
  });

  it('rechaza un valor residual igual o mayor al costo', async () => {
    await expect(
      service.create(own, { ...base, salvage_value: 30000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza entrada en uso anterior a la compra', async () => {
    await expect(
      service.create(own, { ...base, in_service_at: '2026-03-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('escribe en los libros del dueño efectivo', async () => {
    await service.create({ userId: 9, scope: 'ANY', ownerUserId: 1 }, base);

    expect(prisma.fixedAsset.create.mock.calls[0][0].data.user_id).toBe(1);
  });

  describe('vínculo con el gasto de compra', () => {
    it('rechaza un gasto que no está en CAPEX, nombrando su categoría', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        id: 77,
        category: { name: 'Reinversión', type: 'OWNER' },
      });

      const attempt = service.create(own, { ...base, expense_id: 77 });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(/Reinversión/);
      expect(prisma.fixedAsset.create).not.toHaveBeenCalled();
    });

    it('un gasto de otro dueño es 404', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.create(own, { ...base, expense_id: 77 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.expense.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 77,
        user_id: 1,
      });
    });

    it('acepta un gasto CAPEX', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        id: 77,
        category: { name: 'Compra de activo fijo', type: 'CAPEX' },
      });

      await service.create(own, { ...base, expense_id: 77 });

      expect(prisma.fixedAsset.create.mock.calls[0][0].data.expense_id).toBe(
        77,
      );
    });
  });

  it('proyecta depreciación acumulada y valor en libros a una fecha', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue(row());

    const asset = await service.findOne(own, 5, '2026-07-15');

    expect(asset.monthly_depreciation).toBe(1000);
    expect(asset.accumulated_depreciation).toBe(4000);
    expect(asset.book_value).toBe(8000);
    expect(asset.fully_depreciated).toBe(false);
  });

  it('con alcance propio sólo busca entre los activos del dueño', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue(null);

    await expect(service.findOne(own, 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.fixedAsset.findFirst.mock.calls[0][0].where).toEqual({
      id: 5,
      user_id: 1,
    });
  });

  it('la lista filtra por dueño', async () => {
    await service.findAll(own, {});

    expect(prisma.fixedAsset.findMany.mock.calls[0][0].where).toEqual({
      user_id: 1,
    });
  });

  it('la baja guarda fecha y monto y calcula el resultado', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue(row());

    const asset = await service.dispose(own, 5, {
      disposed_at: '2026-08-20',
      disposal_amount: 5000,
    });

    expect(asset.disposal_result).toBe(-3000);
  });

  it('rechaza una baja anterior a la entrada en uso', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue(row());

    await expect(
      service.dispose(own, 5, {
        disposed_at: '2026-01-01',
        disposal_amount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
