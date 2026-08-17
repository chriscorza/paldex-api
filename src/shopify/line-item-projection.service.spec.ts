import { LineItemProjectionService } from './line-item-projection.service';
import { PrismaService } from '../prisma.service';

/*
 * El P&L mensual lee el COGS de `CostOfGoodsSold` y el reporte por canal lee
 * `income.cogs_total`. Los dos salen de aquí, así que este reparto es el único
 * punto donde una venta de Shopify adquiere costo.
 */
describe('LineItemProjectionService — reparto del costo a los ingresos', () => {
  let prisma: any;
  let service: LineItemProjectionService;

  const setup = (
    incomes: any[],
    totalCost: number | null,
    grossSales: number | null = null,
  ) => {
    prisma = {
      income: {
        findMany: jest.fn().mockResolvedValue(incomes),
        update: jest.fn(),
      },
      shopifyLineItem: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { total_cost: totalCost, gross_sales: grossSales },
        }),
      },
      shopifyOrder: {
        findUnique: jest.fn().mockResolvedValue({ order_number: 1001 }),
      },
      costOfGoodsSold: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    service = new LineItemProjectionService(prisma as unknown as PrismaService);
  };

  it('da el costo completo a la venta cobrada de una sola vez', async () => {
    setup([{ id: 50, net_amount: 598.94 }], 300);

    await service.propagateToIncomes(3);

    expect(prisma.income.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { cogs_total: 300, profit_gross: 298.94 },
    });
  });

  it('materializa la fila de COGS que suma el P&L', async () => {
    setup([{ id: 50, net_amount: 598.94 }], 300);

    await service.propagateToIncomes(3);

    const { data } = prisma.costOfGoodsSold.create.mock.calls[0][0];
    expect(data).toMatchObject({
      income_id: 50,
      total_cost: 300,
      source: 'SHOPIFY',
      product_reference: 'Shopify #1001',
    });
  });

  /* Reimportar no debe duplicar el costo, ni borrar los COGS cargados a mano. */
  it('reescribe sólo sus propias filas de COGS', async () => {
    setup([{ id: 50, net_amount: 598.94 }], 300);

    await service.propagateToIncomes(3);

    expect(prisma.costOfGoodsSold.deleteMany).toHaveBeenCalledWith({
      where: { income_id: 50, source: 'SHOPIFY' },
    });
  });

  it('reparte a prorrata cuando el pedido se cobró en varios pagos', async () => {
    setup(
      [
        { id: 50, net_amount: 300 },
        { id: 51, net_amount: 100 },
      ],
      200,
    );

    await service.propagateToIncomes(3);

    const shares = prisma.income.update.mock.calls.map(
      (c: any[]) => c[0].data.cogs_total,
    );
    expect(shares).toEqual([150, 50]);
    /* La suma cuadra con el costo del pedido: ni se duplica ni se pierde. */
    expect(shares[0] + shares[1]).toBe(200);
  });

  it('no deja centavos sueltos al repartir', async () => {
    setup(
      [
        { id: 50, net_amount: 1 },
        { id: 51, net_amount: 1 },
        { id: 52, net_amount: 1 },
      ],
      100,
    );

    await service.propagateToIncomes(3);

    const shares = prisma.income.update.mock.calls.map(
      (c: any[]) => c[0].data.cogs_total,
    );
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(100);
  });

  it('limpia el costo cuando el pedido se queda sin datos', async () => {
    setup([{ id: 50, net_amount: 598.94 }], null);

    await service.propagateToIncomes(3);

    expect(prisma.income.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { cogs_total: null, profit_gross: null },
    });
    expect(prisma.costOfGoodsSold.create).not.toHaveBeenCalled();
  });

  /*
   * El caso del backfill: el pedido se proyecta antes de que existan sus
   * transacciones. Sin ingresos todavía, no hay nada que repartir.
   */
  it('no hace nada si el pedido aún no tiene ingresos', async () => {
    setup([], 300);

    await service.propagateToIncomes(3);

    expect(prisma.shopifyLineItem.aggregate).not.toHaveBeenCalled();
    expect(prisma.income.update).not.toHaveBeenCalled();
  });

  /*
   * El bruto real de la venta vive en los artículos, no en el importe cobrado:
   * éste ya llega con los descuentos. Aquí se verifica que `gross_amount` se
   * derive de ahí y no se quede pegado al neto.
   */
  it('reparte el bruto del pedido entre sus pagos', async () => {
    setup(
      [
        { id: 50, net_amount: 300 },
        { id: 51, net_amount: 100 },
      ],
      200,
      600,
    );

    await service.propagateToIncomes(3);

    const grosses = prisma.income.update.mock.calls
      .map((c: any[]) => c[0].data.gross_amount)
      .filter((g: any) => g !== undefined);
    expect(grosses).toEqual([450, 150]);
  });

  it('deja el bruto por encima del neto cuando hubo descuento', async () => {
    setup([{ id: 50, net_amount: 180 }], 100, 200);

    await service.propagateToIncomes(3);

    expect(prisma.income.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { gross_amount: 200 },
    });
  });

  it('no pisa el bruto si el pedido no tiene artículos proyectados', async () => {
    setup([{ id: 50, net_amount: 598.94 }], 300, null);

    await service.propagateToIncomes(3);

    const grossUpdates = prisma.income.update.mock.calls.filter((c: any[]) =>
      Object.prototype.hasOwnProperty.call(c[0].data, 'gross_amount'),
    );
    expect(grossUpdates).toHaveLength(0);
  });
});

/*
 * Los descuentos llegan en el propio artículo desde que la query bulk los pide,
 * pero la proyección los guardaba en cero, así que `net_sales` era el bruto y el
 * margen de cada categoría salía inflado.
 */
describe('LineItemProjectionService — descuentos e impuestos del artículo', () => {
  let prisma: any;
  let service: LineItemProjectionService;

  const project = async (lineItem: any) => {
    prisma = {
      shopifyOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          created_at: new Date('2026-07-15T10:00:00Z'),
          line_items: [lineItem],
          shopify_connection: { user_id: 10 },
        }),
        update: jest.fn(),
      },
      productCategoryOverride: { findMany: jest.fn().mockResolvedValue([]) },
      productCost: { findMany: jest.fn().mockResolvedValue([]) },
      shopifyLineItem: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { total_cost: null }, _count: { id: 0 } }),
      },
      income: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new LineItemProjectionService(prisma as unknown as PrismaService);
    await service.projectOrder(3);
    return prisma.shopifyLineItem.upsert.mock.calls[0][0].create;
  };

  const lineItem = {
    id: 1,
    product_id: 10,
    variant_id: 20,
    sku: 'CAM-ROJ',
    title: 'Camiseta',
    quantity: 2,
    price: '100.00',
    unit_cost: 40,
    discount_allocations: [{ amount: '15.00' }, { amount: '5.00' }],
    tax_lines: [{ title: 'IVA', rate: 0.16, price: '12.80' }],
  };

  it('resta del neto los descuentos repartidos al artículo', async () => {
    const data = await project(lineItem);

    expect(data.gross_sales).toBe(200);
    expect(data.discount_allocated).toBe(20);
    expect(data.net_sales).toBe(180);
  });

  it('guarda el impuesto sin restarlo del neto', async () => {
    const data = await project(lineItem);

    expect(data.tax_allocated).toBe(12.8);
    expect(data.net_sales).toBe(180);
  });

  /* El margen es lo que se distorsionaba: 100/180 y no 100/200. */
  it('calcula el margen sobre el neto ya descontado', async () => {
    const data = await project(lineItem);

    expect(data.total_cost).toBe(80);
    expect(data.gross_profit).toBe(100);
    expect(data.profit_margin).toBe(55.56);
  });

  it('trata un artículo sin descuentos ni impuestos como cero, no como error', async () => {
    const data = await project({
      ...lineItem,
      discount_allocations: undefined,
      tax_lines: [],
    });

    expect(data.discount_allocated).toBe(0);
    expect(data.tax_allocated).toBe(0);
    expect(data.net_sales).toBe(200);
  });

  it('ignora importes corruptos en vez de tumbar la proyección', async () => {
    const data = await project({
      ...lineItem,
      discount_allocations: [{ amount: 'n/a' }, { amount: '5.00' }, {}],
    });

    expect(data.discount_allocated).toBe(5);
  });
});
