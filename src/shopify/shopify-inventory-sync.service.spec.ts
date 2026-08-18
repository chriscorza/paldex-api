import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopifyInventorySyncService } from './shopify-inventory-sync.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { PrismaService } from '../prisma.service';

const variante = (
  id: string,
  opciones: {
    sku?: string | null;
    productTitle?: string;
    variantTitle?: string;
    tracked?: boolean;
    unitCost?: string | null;
    levels?: { location: string; onHand: number }[];
  } = {},
) => ({
  id,
  sku: opciones.sku === undefined ? 'SKU-1' : opciones.sku,
  title: opciones.variantTitle ?? 'Default Title',
  product: {
    id: 'gid://shopify/Product/1',
    title: opciones.productTitle ?? 'Collar rojo',
  },
  inventoryItem: {
    id: `gid://shopify/InventoryItem/${id.split('/').pop()}`,
    tracked: opciones.tracked ?? true,
    unitCost:
      opciones.unitCost === null
        ? null
        : { amount: opciones.unitCost ?? '85.00' },
    inventoryLevels: {
      edges: (opciones.levels ?? [{ location: 'Tienda', onHand: 12 }]).map(
        (nivel) => ({
          node: {
            location: { name: nivel.location },
            quantities: [{ name: 'on_hand', quantity: nivel.onHand }],
          },
        }),
      ),
    },
  },
});

const pagina = (
  nodos: any[],
  hasNextPage = false,
  endCursor: string | null = null,
) => ({
  productVariants: {
    pageInfo: { hasNextPage, endCursor },
    edges: nodos.map((node) => ({ node })),
  },
});

describe('ShopifyInventorySyncService', () => {
  let service: ShopifyInventorySyncService;
  let graphql: any;
  let prisma: any;

  beforeEach(async () => {
    graphql = { graphql: jest.fn() };
    prisma = {
      shopifyConnection: {
        findUnique: jest.fn().mockResolvedValue({
          shop_domain: 'tienda.myshopify.com',
          scope: 'read_orders,read_inventory',
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyInventorySyncService,
        { provide: ShopifyGraphQLService, useValue: graphql },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ShopifyInventorySyncService>(
      ShopifyInventorySyncService,
    );
  });

  it('devuelve un renglón por variante con sus existencias y su costo', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([variante('gid://shopify/ProductVariant/1')]),
    );

    const rows = await service.fetchInventory(1);

    expect(rows).toEqual([
      {
        shopify_variant_id: '1',
        shopify_inventory_item_id: '1',
        sku: 'SKU-1',
        title: 'Collar rojo',
        location_name: 'Tienda',
        quantity_on_hand: 12,
        tracked: true,
        shopify_unit_cost: 85,
      },
    ]);
  });

  it('guarda el id numérico de la variante, no el GID', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([variante('gid://shopify/ProductVariant/43567890123')]),
    );

    const [row] = await service.fetchInventory(1);

    /* `ProductCost` guarda ids numéricos: con el GID el cruce no acertaría. */
    expect(row.shopify_variant_id).toBe('43567890123');
  });

  it('pide on_hand y no available', async () => {
    graphql.graphql.mockResolvedValue(pagina([]));

    await service.fetchInventory(1);

    const [, query] = graphql.graphql.mock.calls[0];
    expect(query).toContain('quantities(names: ["on_hand"])');
    expect(query).not.toContain('available');
  });

  it('recorre todas las páginas del catálogo', async () => {
    graphql.graphql
      .mockResolvedValueOnce(
        pagina([variante('gid://shopify/ProductVariant/1')], true, 'cursor-1'),
      )
      .mockResolvedValueOnce(
        pagina([variante('gid://shopify/ProductVariant/2')], true, 'cursor-2'),
      )
      .mockResolvedValueOnce(
        pagina([variante('gid://shopify/ProductVariant/3')]),
      );

    const rows = await service.fetchInventory(1);

    expect(rows).toHaveLength(3);
    expect(graphql.graphql).toHaveBeenCalledTimes(3);
    expect(graphql.graphql.mock.calls[1][2]).toMatchObject({
      cursor: 'cursor-1',
    });
    expect(graphql.graphql.mock.calls[2][2]).toMatchObject({
      cursor: 'cursor-2',
    });
  });

  it('marca como desconocida la existencia de una variante sin rastreo', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([
        variante('gid://shopify/ProductVariant/1', {
          tracked: false,
          levels: [],
        }),
      ]),
    );

    const [row] = await service.fetchInventory(1);

    expect(row.tracked).toBe(false);
    expect(row.quantity_on_hand).toBeNull();
  });

  it('conserva una existencia negativa', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([
        variante('gid://shopify/ProductVariant/1', {
          levels: [{ location: 'Tienda', onHand: -3 }],
        }),
      ]),
    );

    const [row] = await service.fetchInventory(1);

    expect(row.quantity_on_hand).toBe(-3);
  });

  it('devuelve un renglón por sucursal', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([
        variante('gid://shopify/ProductVariant/1', {
          levels: [
            { location: 'Tienda', onHand: 12 },
            { location: 'Bodega', onHand: 30 },
          ],
        }),
      ]),
    );

    const rows = await service.fetchInventory(1);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.location_name, r.quantity_on_hand])).toEqual([
      ['Tienda', 12],
      ['Bodega', 30],
    ]);
  });

  it('da cero a la variante rastreada que no está en ninguna sucursal', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([variante('gid://shopify/ProductVariant/1', { levels: [] })]),
    );

    const [row] = await service.fetchInventory(1);

    expect(row.quantity_on_hand).toBe(0);
    expect(row.tracked).toBe(true);
  });

  it('arma el nombre con el del producto y el de la variante', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([
        variante('gid://shopify/ProductVariant/1', {
          productTitle: 'Arnés',
          variantTitle: 'Talla M',
        }),
      ]),
    );

    const [row] = await service.fetchInventory(1);

    expect(row.title).toBe('Arnés - Talla M');
  });

  it('deja el costo nulo cuando Shopify no lo trae', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([variante('gid://shopify/ProductVariant/1', { unitCost: null })]),
    );

    const [row] = await service.fetchInventory(1);

    expect(row.shopify_unit_cost).toBeNull();
  });

  it('rechaza la conexión sin el permiso read_inventory sin llamar a Shopify', async () => {
    prisma.shopifyConnection.findUnique.mockResolvedValue({
      shop_domain: 'tienda.myshopify.com',
      scope: 'read_orders',
    });

    await expect(service.fetchInventory(1)).rejects.toThrow(
      BadRequestException,
    );
    expect(graphql.graphql).not.toHaveBeenCalled();
  });

  it('falla si la conexión no existe', async () => {
    prisma.shopifyConnection.findUnique.mockResolvedValue(null);

    await expect(service.fetchInventory(1)).rejects.toThrow(NotFoundException);
    expect(graphql.graphql).not.toHaveBeenCalled();
  });

  it('corta un catálogo que no termina en vez de paginar sin fin', async () => {
    graphql.graphql.mockResolvedValue(
      pagina([variante('gid://shopify/ProductVariant/1')], true, 'cursor'),
    );

    await expect(service.fetchInventory(1)).rejects.toThrow(/excede/);
  });
});
