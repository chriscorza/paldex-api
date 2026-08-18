import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { PrismaService } from '../prisma.service';
import { ShopifyInventorySyncService } from '../shopify/shopify-inventory-sync.service';

const Decimal = Prisma.Decimal;

const ctx = { userId: 1, scope: 'OWN' as const };
const TAKEN_AT = new Date('2026-08-18T12:00:00.000Z');

const nivel = (over: Partial<any> = {}) => ({
  shopify_variant_id: '100',
  shopify_inventory_item_id: '900',
  sku: 'A-100',
  title: 'Collar rojo',
  location_name: 'Tienda',
  quantity_on_hand: 10,
  tracked: true,
  shopify_unit_cost: 75,
  shopify_unit_price: 120,
  ...over,
});

const costo = (over: Partial<any> = {}) => ({
  shopify_variant_id: null,
  sku: null,
  unit_cost: new Decimal(90),
  ...over,
});

describe('InventorySnapshotService', () => {
  let service: InventorySnapshotService;
  let prisma: any;
  let sync: any;

  /* Lo que quedó guardado en la foto tras la captura. */
  const itemsEscritos = () =>
    prisma.inventorySnapshotItem.createMany.mock.calls[0][0].data;
  const cierre = () => prisma.inventorySnapshot.update.mock.calls[0][0].data;

  beforeEach(async () => {
    sync = { fetchInventory: jest.fn().mockResolvedValue([]) };
    prisma = {
      shopifyConnection: {
        findMany: jest.fn().mockResolvedValue([{ id: 7, user_id: 1 }]),
      },
      inventorySnapshot: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 42, taken_at: TAKEN_AT, status: 'PENDING' }),
        update: jest.fn().mockResolvedValue({ id: 42, status: 'COMPLETE' }),
      },
      inventorySnapshotItem: { createMany: jest.fn().mockResolvedValue({}) },
      productCost: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventorySnapshotService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopifyInventorySyncService, useValue: sync },
      ],
    }).compile();

    service = module.get<InventorySnapshotService>(InventorySnapshotService);
  });

  describe('precedencia del costo', () => {
    it('el catálogo por variante gana sobre el de Shopify', async () => {
      prisma.productCost.findMany.mockResolvedValue([
        costo({ shopify_variant_id: '100', unit_cost: new Decimal(90) }),
      ]);
      sync.fetchInventory.mockResolvedValue([nivel()]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.cost_source).toBe('VARIANT');
      expect(item.unit_cost.toString()).toBe('90');
      expect(item.total_cost.toString()).toBe('900');
    });

    it('el catálogo por SKU gana sobre el de Shopify cuando no hay variante', async () => {
      prisma.productCost.findMany.mockResolvedValue([
        costo({ sku: 'A-100', unit_cost: new Decimal(88) }),
      ]);
      sync.fetchInventory.mockResolvedValue([nivel()]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.cost_source).toBe('SKU');
      expect(item.unit_cost.toString()).toBe('88');
    });

    it('usa el costo de Shopify cuando el catálogo no tiene nada', async () => {
      sync.fetchInventory.mockResolvedValue([nivel()]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.cost_source).toBe('SHOPIFY');
      expect(item.unit_cost.toString()).toBe('75');
    });

    it('se queda con el costo vigente más reciente del catálogo', async () => {
      /* Vienen ordenados ascendente por `effective_from`: gana el último. */
      prisma.productCost.findMany.mockResolvedValue([
        costo({ shopify_variant_id: '100', unit_cost: new Decimal(80) }),
        costo({ shopify_variant_id: '100', unit_cost: new Decimal(95) }),
      ]);
      sync.fetchInventory.mockResolvedValue([nivel()]);

      await service.capture(7, 1);

      expect(itemsEscritos()[0].unit_cost.toString()).toBe('95');
    });

    it('pide al catálogo sólo los costos vigentes a la fecha de la foto', async () => {
      await service.capture(7, 1);

      expect(prisma.productCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 1, effective_from: { lte: TAKEN_AT } },
        }),
      );
    });

    it('deja sin costo el renglón que nadie costeó', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ shopify_unit_cost: null }),
      ]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.unit_cost).toBeNull();
      expect(item.total_cost).toBeNull();
      expect(item.cost_source).toBeNull();
      expect(cierre().products_without_cost).toBe(1);
      expect(cierre().total_cost.toString()).toBe('0');
    });
  });

  describe('existencias', () => {
    it('no valúa la variante sin rastreo, pero conserva su costo unitario', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ tracked: false, quantity_on_hand: null }),
      ]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.unit_cost.toString()).toBe('75');
      expect(item.total_cost).toBeNull();
      expect(cierre().total_units).toBe(0);
      expect(cierre().variants_untracked).toBe(1);
    });

    it('valúa en negativo una existencia negativa', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ quantity_on_hand: -3, shopify_unit_cost: 100 }),
      ]);

      await service.capture(7, 1);

      expect(itemsEscritos()[0].total_cost.toString()).toBe('-300');
      expect(cierre().total_units).toBe(-3);
      expect(cierre().total_cost.toString()).toBe('-300');
    });

    it('cuenta por producto y no por renglón cuando hay varias sucursales', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ location_name: 'Tienda', quantity_on_hand: 10 }),
        nivel({ location_name: 'Bodega', quantity_on_hand: 5 }),
      ]);

      await service.capture(7, 1);

      expect(itemsEscritos()).toHaveLength(2);
      expect(cierre().products_valued).toBe(1);
      expect(cierre().total_units).toBe(15);
      expect(cierre().total_cost.toString()).toBe('1125');
    });
  });

  describe('valor de venta', () => {
    it('valúa las existencias al precio de lista además del costo', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({
          quantity_on_hand: 10,
          shopify_unit_cost: 75,
          shopify_unit_price: 120,
        }),
      ]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.unit_price.toString()).toBe('120');
      expect(item.total_price.toString()).toBe('1200');
      expect(cierre().retail_value.toString()).toBe('1200');
      expect(cierre().total_cost.toString()).toBe('750');
    });

    it('no inventa precio cuando Shopify no lo trae', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ shopify_unit_price: null }),
      ]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      expect(item.unit_price).toBeNull();
      expect(item.total_price).toBeNull();
      expect(cierre().retail_value.toString()).toBe('0');
    });

    it('no calcula valor de venta sin existencia conocida', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ tracked: false, quantity_on_hand: null }),
      ]);

      await service.capture(7, 1);

      const [item] = itemsEscritos();
      /* Se sabe a cuánto se vende la pieza, no cuántas hay. */
      expect(item.unit_price.toString()).toBe('120');
      expect(item.total_price).toBeNull();
    });
  });

  describe('ciclo de vida de la foto', () => {
    it('nace PENDING y cierra COMPLETE', async () => {
      await service.capture(7, 1);

      expect(prisma.inventorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(cierre().status).toBe('COMPLETE');
    });

    it('queda FAILED si la captura se cae a la mitad', async () => {
      sync.fetchInventory.mockRejectedValue(new Error('throttled by Shopify'));

      await expect(service.capture(7, 1)).rejects.toThrow('throttled');

      expect(cierre().status).toBe('FAILED');
      expect(cierre().failure_reason).toContain('throttled');
    });
  });

  describe('siembra del catálogo de costos', () => {
    it('copia el costo de Shopify al catálogo cuando el dueño no lo tiene', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ location_name: 'Tienda' }),
        nivel({ location_name: 'Bodega' }),
      ]);

      await service.capture(7, 1);

      const sembrados = prisma.productCost.createMany.mock.calls[0][0].data;
      /* Una sola siembra aunque la variante llegue por dos sucursales. */
      expect(sembrados).toHaveLength(1);
      expect(sembrados[0]).toMatchObject({
        shopify_variant_id: '100',
        sku: 'A-100',
        source: 'SHOPIFY_INVENTORY',
        user_id: 1,
      });
    });

    it('no pisa un costo que el dueño ya capturó', async () => {
      prisma.productCost.findMany.mockResolvedValue([
        costo({ shopify_variant_id: '100' }),
      ]);
      sync.fetchInventory.mockResolvedValue([nivel()]);

      await service.capture(7, 1);

      expect(prisma.productCost.createMany).not.toHaveBeenCalled();
    });

    it('no siembra nada si Shopify no trae costo', async () => {
      sync.fetchInventory.mockResolvedValue([
        nivel({ shopify_unit_cost: null }),
      ]);

      await service.capture(7, 1);

      expect(prisma.productCost.createMany).not.toHaveBeenCalled();
    });
  });

  describe('captura por dueño', () => {
    it('toma una foto por cada conexión activa del dueño', async () => {
      prisma.shopifyConnection.findMany.mockResolvedValue([
        { id: 7, user_id: 1 },
        { id: 8, user_id: 1 },
      ]);

      await service.captureForOwner(ctx);

      expect(prisma.inventorySnapshot.create).toHaveBeenCalledTimes(2);
      expect(prisma.shopifyConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 1, status: 'ACTIVE' },
        }),
      );
    });

    it('lista sólo las fotos del dueño con alcance propio', async () => {
      prisma.$transaction = jest.fn().mockResolvedValue([[], 0]);
      prisma.inventorySnapshot.findMany = jest.fn();
      prisma.inventorySnapshot.count = jest.fn();

      await service.listSnapshots(ctx, {});

      expect(prisma.inventorySnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 1 },
          orderBy: { taken_at: 'desc' },
        }),
      );
    });

    it('no filtra por dueño con alcance total', async () => {
      prisma.$transaction = jest.fn().mockResolvedValue([[], 0]);
      prisma.inventorySnapshot.findMany = jest.fn();
      prisma.inventorySnapshot.count = jest.fn();

      await service.listSnapshots({ userId: 1, scope: 'ANY' }, {});

      expect(
        prisma.inventorySnapshot.findMany.mock.calls[0][0].where,
      ).not.toHaveProperty('user_id');
    });

    it('falla explícitamente si el dueño no tiene conexión activa', async () => {
      prisma.shopifyConnection.findMany.mockResolvedValue([]);

      await expect(service.captureForOwner(ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.inventorySnapshot.create).not.toHaveBeenCalled();
    });
  });
});
