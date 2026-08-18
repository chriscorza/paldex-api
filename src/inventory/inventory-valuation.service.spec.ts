import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryValuationService } from './inventory-valuation.service';
import { PrismaService } from '../prisma.service';

const Decimal = Prisma.Decimal;

const ctx = { userId: 1, scope: 'OWN' as const };

const foto = (id: number, takenAt: string, connectionId = 7) => ({
  id,
  taken_at: new Date(takenAt),
  shopify_connection_id: connectionId,
});

const renglon = (over: Partial<any> = {}) => {
  const item = {
    shopify_variant_id: '100',
    sku: 'A-100',
    title: 'Collar rojo',
    location_name: 'Tienda',
    quantity_on_hand: 10,
    tracked: true,
    unit_cost: new Decimal(85),
    cost_source: 'VARIANT',
    ...over,
  };
  /* El costo total viene congelado en la foto, como lo escribe la captura. */
  if (!('total_cost' in over)) {
    (item as any).total_cost =
      item.unit_cost === null || item.quantity_on_hand === null
        ? null
        : new Decimal(item.unit_cost).times(item.quantity_on_hand);
  } else {
    (item as any).total_cost = (over as any).total_cost;
  }
  return item;
};

describe('InventoryValuationService', () => {
  let service: InventoryValuationService;
  let prisma: any;

  const conFoto = (fotos: any[], renglones: any[]) => {
    prisma.inventorySnapshot.findMany.mockResolvedValue(fotos);
    prisma.inventorySnapshotItem.findMany.mockResolvedValue(renglones);
  };

  beforeEach(async () => {
    process.env.REPORTS_TIMEZONE = 'America/Mexico_City';
    prisma = {
      inventorySnapshot: {
        findMany: jest
          .fn()
          .mockResolvedValue([foto(1, '2026-08-18T12:00:00Z')]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      inventorySnapshotItem: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryValuationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InventoryValuationService>(InventoryValuationService);
  });

  it('ordena de mayor a menor costo total', async () => {
    conFoto(
      [foto(1, '2026-08-18T12:00:00Z')],
      [
        renglon({
          shopify_variant_id: '1',
          title: 'Arnés',
          quantity_on_hand: 40,
          unit_cost: new Decimal(150),
        }),
        renglon({
          shopify_variant_id: '2',
          title: 'Collar',
          quantity_on_hand: 120,
          unit_cost: new Decimal(85),
        }),
      ],
    );

    const report = await service.getValuation(ctx, {});

    expect(report.products.map((p) => p.title)).toEqual(['Collar', 'Arnés']);
    expect(report.products[0].total_cost).toBe(10200);
    expect(report.totals.total_cost).toBe(16200);
    expect(report.totals.total_units).toBe(160);
    expect(report.totals.cost_coverage).toBe(100);
  });

  it('agrupa en un renglón los varios que traiga la foto del mismo producto', async () => {
    conFoto(
      [foto(1, '2026-08-18T12:00:00Z')],
      [
        renglon({ location_name: 'Tienda', quantity_on_hand: 10 }),
        renglon({ location_name: 'Bodega', quantity_on_hand: 5 }),
      ],
    );

    const report = await service.getValuation(ctx, {});

    expect(report.products).toHaveLength(1);
    expect(report.products[0].quantity_on_hand).toBe(15);
    expect(report.products[0].total_cost).toBe(1275);
  });

  it('reporta la cobertura y deja fuera del total lo que no tiene costo', async () => {
    conFoto(
      [foto(1, '2026-08-18T12:00:00Z')],
      [
        renglon({ shopify_variant_id: '1', quantity_on_hand: 80 }),
        renglon({
          shopify_variant_id: '2',
          title: 'Juguete sin costear',
          quantity_on_hand: 20,
          unit_cost: null,
          cost_source: null,
          total_cost: null,
        }),
      ],
    );

    const report = await service.getValuation(ctx, {});

    expect(report.totals.cost_coverage).toBe(80);
    expect(report.totals.units_without_cost).toBe(20);
    expect(report.totals.products_without_cost).toBe(1);
    expect(report.totals.total_cost).toBe(6800);
    /* Sin costo siempre al final. */
    expect(report.products[1].title).toBe('Juguete sin costear');
    expect(report.products[1].total_cost).toBeNull();
  });

  it('no valúa la existencia desconocida y la reporta aparte', async () => {
    conFoto(
      [foto(1, '2026-08-18T12:00:00Z')],
      [
        renglon({
          quantity_on_hand: null,
          tracked: false,
          location_name: null,
          total_cost: null,
        }),
      ],
    );

    const report = await service.getValuation(ctx, {});

    expect(report.products[0].quantity_on_hand).toBeNull();
    expect(report.totals.products_untracked).toBe(1);
    expect(report.totals.total_units).toBe(0);
    expect(report.totals.cost_coverage).toBeNull();
  });

  it('valúa la foto vigente a una fecha pasada', async () => {
    conFoto([foto(2, '2026-07-31T12:00:00Z')], [renglon()]);

    const report = await service.getValuation(ctx, { as_of: '2026-07-31' });

    expect(report.source.snapshot_ids).toEqual([2]);
    const { where } = prisma.inventorySnapshot.findMany.mock.calls[0][0];
    expect(where.status).toBe('COMPLETE');
    /* Fin del día en la zona del negocio, no en UTC. */
    expect(where.taken_at.lte.toISOString()).toBe('2026-08-01T05:59:59.999Z');
  });

  it('valúa la foto que se le pida por id', async () => {
    prisma.inventorySnapshot.findFirst.mockResolvedValue(
      foto(9, '2026-06-30T12:00:00Z'),
    );
    prisma.inventorySnapshotItem.findMany.mockResolvedValue([renglon()]);

    const report = await service.getValuation(ctx, { snapshot_id: 9 });

    expect(report.source.snapshot_ids).toEqual([9]);
    expect(prisma.inventorySnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9, user_id: 1, status: 'COMPLETE' },
      }),
    );
  });

  it('suma la foto más reciente de cada conexión', async () => {
    conFoto(
      [
        foto(3, '2026-08-18T12:00:00Z', 7),
        foto(2, '2026-08-18T11:00:00Z', 8),
        foto(1, '2026-08-17T12:00:00Z', 7),
      ],
      [renglon()],
    );

    const report = await service.getValuation(ctx, {});

    /* La foto vieja de la conexión 7 queda fuera; la de la 8 no. */
    expect(report.source.snapshot_ids).toEqual([3, 2]);
    expect(report.source.connections).toBe(2);
    expect(prisma.inventorySnapshotItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { snapshot_id: { in: [3, 2] } } }),
    );
  });

  it('calcula los totales sobre el avalúo completo, no sobre la página', async () => {
    conFoto(
      [foto(1, '2026-08-18T12:00:00Z')],
      [
        renglon({
          shopify_variant_id: '1',
          title: 'A',
          quantity_on_hand: 1,
          unit_cost: new Decimal(10),
        }),
        renglon({
          shopify_variant_id: '2',
          title: 'B',
          quantity_on_hand: 1,
          unit_cost: new Decimal(20),
        }),
        renglon({
          shopify_variant_id: '3',
          title: 'C',
          quantity_on_hand: 1,
          unit_cost: new Decimal(30),
        }),
      ],
    );

    const report = await service.getValuation(ctx, { page: 2, limit: 2 });

    expect(report.products).toHaveLength(1);
    expect(report.products[0].title).toBe('A');
    expect(report.total).toBe(3);
    expect(report.totals.total_cost).toBe(60);
  });

  it('dice que no hay avalúo en vez de devolver ceros', async () => {
    prisma.inventorySnapshot.findMany.mockResolvedValue([]);

    await expect(service.getValuation(ctx, {})).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getValuation(ctx, {})).rejects.toThrow(
      /POST \/inventory\/snapshots/,
    );
  });

  it('rechaza pedir a la vez una foto por id y por fecha', async () => {
    await expect(
      service.getValuation(ctx, { snapshot_id: 1, as_of: '2026-08-01' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('filtra por dueño con alcance propio y no con alcance total', async () => {
    conFoto([foto(1, '2026-08-18T12:00:00Z')], [renglon()]);

    await service.getValuation(ctx, {});
    expect(
      prisma.inventorySnapshot.findMany.mock.calls[0][0].where,
    ).toMatchObject({ user_id: 1 });

    await service.getValuation({ userId: 1, scope: 'ANY' }, {});
    expect(
      prisma.inventorySnapshot.findMany.mock.calls[1][0].where,
    ).not.toHaveProperty('user_id');
  });
});
