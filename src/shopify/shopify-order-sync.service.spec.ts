import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { LineItemProjectionService } from './line-item-projection.service';

/*
 * Esta consulta era una llamada a Shopify por cada pedido. En una importación
 * de miles, las rachas de THROTTLED dejaban pedidos sin costo y sin categoría
 * con sólo un warn, y la única forma de recuperarlos era reimportar entero.
 */
describe('ShopifyOrderSyncService — consulta de enriquecimiento', () => {
  let service: ShopifyOrderSyncService;
  let graphql: any;
  let prisma: any;

  beforeEach(async () => {
    graphql = { graphql: jest.fn().mockResolvedValue({ nodes: [] }) };
    prisma = {
      shopifyOrder: {
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 3 }),
      },
      income: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyOrderSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopifyGraphQLService, useValue: graphql },
        {
          provide: LineItemProjectionService,
          useValue: { projectOrder: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ShopifyOrderSyncService>(ShopifyOrderSyncService);
  });

  const order = (lineItems: any[]) => ({
    admin_graphql_api_id: 'gid://shopify/Order/450789469',
    order_number: 1001,
    created_at: '2026-03-01T09:58:00Z',
    total_price: '598.94',
    line_items: lineItems,
  });

  it('no pregunta nada si el bulk ya trajo costo y categoría', async () => {
    await service.handleOrderCreate(
      1,
      order([
        {
          id: 1,
          variant_id: 20,
          quantity: 1,
          price: '199.00',
          product_type: 'Pokemon',
          tags: ['tcg'],
          unit_cost: 40.5,
        },
      ]),
    );

    expect(graphql.graphql).not.toHaveBeenCalled();
  });

  it('pregunta por el artículo que llega crudo del webhook', async () => {
    await service.handleOrderCreate(
      1,
      order([{ id: 1, variant_id: 20, quantity: 1, price: '199.00' }]),
    );

    expect(graphql.graphql).toHaveBeenCalledTimes(1);
  });

  /* Sin `productType` la categoría sólo puede salir de las colecciones. */
  it('pregunta cuando el producto no tiene tipo, para mirar las colecciones', async () => {
    await service.handleOrderCreate(
      1,
      order([
        {
          id: 1,
          variant_id: 20,
          quantity: 1,
          price: '199.00',
          product_type: null,
          unit_cost: 40.5,
        },
      ]),
    );

    expect(graphql.graphql).toHaveBeenCalledTimes(1);
  });

  it('no borra lo que trajo el bulk cuando la consulta no devuelve nada', async () => {
    await service.handleOrderCreate(
      1,
      order([
        {
          id: 1,
          variant_id: 20,
          quantity: 1,
          price: '199.00',
          product_type: null,
          tags: ['tcg'],
          unit_cost: 40.5,
        },
      ]),
    );

    const { create } = prisma.shopifyOrder.upsert.mock.calls[0][0];
    expect(create.line_items[0]).toMatchObject({
      unit_cost: 40.5,
      tags: ['tcg'],
    });
  });

  it('reintenta cuando Shopify responde THROTTLED', async () => {
    graphql.graphql
      .mockRejectedValueOnce(new Error('GraphQL error: Throttled'))
      .mockResolvedValueOnce({ nodes: [] });

    await service.handleOrderCreate(
      1,
      order([{ id: 1, variant_id: 20, quantity: 1, price: '199.00' }]),
    );

    expect(graphql.graphql).toHaveBeenCalledTimes(2);
  }, 15000);

  it('no reintenta un error que no es de cuota', async () => {
    graphql.graphql.mockRejectedValue(
      new Error('GraphQL error: Access denied'),
    );

    await service.handleOrderCreate(
      1,
      order([{ id: 1, variant_id: 20, quantity: 1, price: '199.00' }]),
    );

    expect(graphql.graphql).toHaveBeenCalledTimes(1);
  });
});
