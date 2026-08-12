import { ShopifyProfitabilityService } from './shopify-profitability.service';
import { PrismaService } from '../prisma.service';
import { OwnershipContext } from '../common/ownership';

/*
 * Una línea de pedido tal como la devuelve el `select` del reporte. `unit_cost`
 * en null es «no sabemos qué costó»; el resto de importes vienen como Decimal
 * de Prisma, aquí basta con números.
 */
const line = (overrides: Partial<Record<string, any>> = {}) => ({
  category_name: 'Pokemon',
  category_source: 'PRODUCT_TYPE',
  quantity: 1,
  gross_sales: 100,
  discount_allocated: 0,
  net_sales: 100,
  total_cost: 60,
  gross_profit: 40,
  profit_margin: 40,
  unit_cost: 60,
  shopify_order_id: 1,
  title: 'Booster Box',
  ...overrides,
});

describe('ShopifyProfitabilityService — calidad del dato de costos', () => {
  const ctx: OwnershipContext = { userId: 1, scope: 'OWN' };
  const query = { start_date: '2026-03-01', end_date: '2026-03-31' } as any;

  const serviceWith = (lines: any[]) => {
    const prisma = {
      shopifyLineItem: { findMany: jest.fn().mockResolvedValue(lines) },
    } as unknown as PrismaService;
    return new ShopifyProfitabilityService(prisma);
  };

  /*
   * La regresión que motivó el test: contar por categoría en vez de por línea
   * daba 0 artículos con costo y 0 % de cobertura aunque el COGS estuviera ahí.
   */
  it('mide la cobertura por artículo, no por categoría', async () => {
    const service = serviceWith([
      line(),
      line(),
      line({ unit_cost: null, total_cost: null, gross_profit: null }),
    ]);

    const { cost_data_quality: quality } =
      await service.getCategoryProfitability(ctx, query);

    expect(quality.total_line_items).toBe(3);
    expect(quality.line_items_with_cost).toBe(2);
    expect(quality.missing_cost_items).toBe(1);
    expect(quality.cost_data_coverage).toBe(66.67);
  });

  it('no da por perdida la categoría entera cuando falta un solo costo', async () => {
    const service = serviceWith([
      line(),
      line({ unit_cost: null, total_cost: null, gross_profit: null }),
    ]);

    const { cost_data_quality: quality, categories } =
      await service.getCategoryProfitability(ctx, query);

    /* Sólo las ventas de la línea sin costo, no las 200 de la categoría. */
    expect(quality.sales_without_cost).toBe(100);
    expect(quality.gross_profit_confirmed).toBe(40);
    /* La categoría sigue marcada como incompleta: hay algo que revisar. */
    expect(categories[0].incomplete_cost_data).toBe(true);
    expect(categories[0].cogs).toBe(60);
  });

  it('deja la cobertura en null cuando no hay ventas en el periodo', async () => {
    const service = serviceWith([]);

    const { cost_data_quality: quality } =
      await service.getCategoryProfitability(ctx, query);

    expect(quality.total_line_items).toBe(0);
    expect(quality.cost_data_coverage).toBeNull();
    expect(quality.sales_without_cost).toBe(0);
  });
});

/*
 * El reporte de Shopify y el de paldex no cuadran por construcción: Shopify
 * cuenta el pedido el día que se hizo y paldex el ingreso el día que se cobró.
 * Esta conciliación aísla la parte de esa diferencia que sí es un agujero:
 * pedidos que nunca generaron cobro.
 */
describe('ShopifyProfitabilityService — pedidos sin ingreso', () => {
  const ctx: OwnershipContext = { userId: 1, scope: 'OWN' };
  const query = { start_date: '2026-07-01', end_date: '2026-08-01' } as any;

  const orders = [
    {
      id: 9,
      order_number: 1042,
      created_at: new Date('2026-07-14T12:00:00Z'),
      items_total: 6785,
      shopify_order_total: 6785,
      discount_total: 0,
      tax_total: 0,
    },
  ];

  const serviceWith = (ordersTotal: number, orphanCount: number) => {
    const prisma: any = {
      shopifyOrder: {
        count: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      income: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { net_amount: 113839.9 },
          _count: { id: 303 },
        }),
      },
      $transaction: jest
        .fn()
        .mockResolvedValue([
          ordersTotal,
          orphanCount,
          { _sum: { shopify_order_total: 6785, items_total: 6785 } },
          orders,
        ]),
    };
    return {
      prisma,
      service: new ShopifyProfitabilityService(prisma as PrismaService),
    };
  };

  it('cuantifica el hueco entre pedidos y cobros del periodo', async () => {
    const { service } = serviceWith(310, 7);

    const { summary } = await service.getOrdersWithoutIncome(ctx, query);

    expect(summary.orders_total).toBe(310);
    expect(summary.orders_with_income).toBe(303);
    expect(summary.orders_without_income).toBe(7);
    expect(summary.sales_without_income).toBe(6785);
    expect(summary.income_total).toBe(113839.9);
  });

  it('sólo mira pedidos sin ningún ingreso colgado', async () => {
    const { prisma, service } = serviceWith(310, 7);

    await service.getOrdersWithoutIncome(ctx, query);

    const { where } = prisma.shopifyOrder.findMany.mock.calls[0][0];
    expect(where.incomes).toEqual({ none: {} });
    /* El rango va en la zona del negocio, no en UTC. */
    expect(where.created_at.gte.toISOString()).toBe('2026-07-01T06:00:00.000Z');
    expect(where.created_at.lte.toISOString()).toBe('2026-08-02T05:59:59.999Z');
    expect(where.shopify_connection).toEqual({ user_id: 1 });
  });

  it('devuelve cada pedido con su número y su fecha real', async () => {
    const { service } = serviceWith(310, 7);

    const { data, total } = await service.getOrdersWithoutIncome(ctx, query);

    expect(total).toBe(7);
    expect(data[0]).toMatchObject({
      order_id: 9,
      order_number: 1042,
      order_total: 6785,
    });
  });

  it('rechaza un rango invertido', async () => {
    const { service } = serviceWith(0, 0);

    await expect(
      service.getOrdersWithoutIncome(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-07-01',
      } as any),
    ).rejects.toThrow('start_date must be before end_date');
  });
});
