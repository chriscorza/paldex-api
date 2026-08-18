import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryCostService } from './inventory-cost.service';
import { PrismaService } from '../prisma.service';

const Decimal = Prisma.Decimal;

const ctx = { userId: 1, scope: 'OWN' as const };

/* Agosto de 2026, el periodo por omisión de casi todas las pruebas. */
const AGOSTO = { year: 2026, month: 8 };

const costo = (
  unitCost: number,
  ids: { variant?: string; sku?: string },
  effectiveFrom = '2026-01-01T00:00:00.000Z',
) => ({
  shopify_variant_id: ids.variant ?? null,
  sku: ids.sku ?? null,
  unit_cost: new Decimal(unitCost),
  effective_from: new Date(effectiveFrom),
});

const articulo = (
  title: string,
  quantity: number,
  ids: { variant?: string; sku?: string },
  unitCost: number | null = null,
) => ({
  shopify_variant_id: ids.variant ?? null,
  sku: ids.sku ?? null,
  title,
  quantity,
  unit_cost: unitCost === null ? null : new Decimal(unitCost),
  total_cost: unitCost === null ? null : new Decimal(unitCost * quantity),
});

describe('InventoryCostService', () => {
  let service: InventoryCostService;
  let prisma: any;

  const originalZone = process.env.REPORTS_TIMEZONE;

  /*
   * `shopifyLineItem.findMany` se llama dos veces: las ventas del periodo y,
   * después, la búsqueda de nombres para los productos del catálogo que no se
   * vendieron. La segunda se reconoce por el `OR` de identificadores.
   */
  const conVentas = (periodo: any[], historicas: any[] = []) => {
    prisma.shopifyLineItem.findMany.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.OR ? historicas : periodo),
    );
  };

  beforeEach(async () => {
    process.env.REPORTS_TIMEZONE = 'America/Mexico_City';

    prisma = {
      productCost: { findMany: jest.fn().mockResolvedValue([]) },
      shopifyLineItem: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryCostService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InventoryCostService>(InventoryCostService);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalZone === undefined) delete process.env.REPORTS_TIMEZONE;
    else process.env.REPORTS_TIMEZONE = originalZone;
  });

  it('ordena de mayor a menor costo total', async () => {
    prisma.productCost.findMany.mockResolvedValue([
      costo(85, { sku: 'A-100' }),
      costo(150, { sku: 'B-220' }),
    ]);
    conVentas([
      articulo('Collar rojo', 120, { sku: 'A-100' }),
      articulo('Arnés talla M', 40, { sku: 'B-220' }),
    ]);

    const report = await service.getInventoryCost(ctx, AGOSTO);

    expect(report.products.map((p) => p.sku)).toEqual(['A-100', 'B-220']);
    expect(report.products[0].total_cost).toBe(10200);
    expect(report.products[1].total_cost).toBe(6000);
    expect(report.totals.total_cost).toBe(16200);
    expect(report.totals.units_sold).toBe(160);
    expect(report.totals.cost_coverage).toBe(100);
  });

  it('lista el producto del catálogo que no se vendió, con su costo y total en cero', async () => {
    prisma.productCost.findMany.mockResolvedValue([
      costo(310, { sku: 'D-500' }),
    ]);
    /* Nunca se vendió en agosto, pero sí alguna vez: de ahí sale el nombre. */
    conVentas(
      [],
      [{ shopify_variant_id: null, sku: 'D-500', title: 'Cama grande' }],
    );

    const report = await service.getInventoryCost(ctx, AGOSTO);

    expect(report.products).toHaveLength(1);
    expect(report.products[0]).toMatchObject({
      sku: 'D-500',
      title: 'Cama grande',
      unit_cost: 310,
      units_sold: 0,
      total_cost: 0,
      in_catalog: true,
    });
    expect(report.totals.products_without_sales).toBe(1);
    expect(report.totals.products_in_catalog).toBe(1);
  });

  it('usa el costo vigente al cierre e ignora el que aún no entra en vigor', async () => {
    /*
     * El servicio ya filtra por `effective_from <= end_date` en la consulta; lo
     * que se prueba aquí es que entre los vigentes se quede con el más reciente.
     */
    prisma.productCost.findMany.mockResolvedValue([
      costo(80, { sku: 'A-100' }, '2026-01-01T00:00:00.000Z'),
      costo(95, { sku: 'A-100' }, '2026-07-15T00:00:00.000Z'),
    ]);
    conVentas([articulo('Collar rojo', 10, { sku: 'A-100' })]);

    const report = await service.getInventoryCost(ctx, AGOSTO);

    expect(report.products[0].unit_cost).toBe(95);
    expect(report.products[0].total_cost).toBe(950);
    expect(prisma.productCost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          effective_from: { lte: expect.any(Date) },
        }),
      }),
    );
    const { effective_from } =
      prisma.productCost.findMany.mock.calls[0][0].where;
    expect(effective_from.lte.toISOString()).toBe('2026-09-01T05:59:59.999Z');
  });

  it('no duplica el producto cuando el catálogo lo tiene por variante y la venta trae sólo el SKU', async () => {
    prisma.productCost.findMany.mockResolvedValue([
      costo(85, { variant: 'gid-1', sku: 'A-100' }),
    ]);
    conVentas([
      articulo('Collar rojo', 2, { variant: 'gid-1', sku: 'A-100' }),
      articulo('Collar rojo', 3, { sku: 'A-100' }),
    ]);

    const report = await service.getInventoryCost(ctx, AGOSTO);

    expect(report.products).toHaveLength(1);
    expect(report.products[0].units_sold).toBe(5);
    expect(report.products[0].total_cost).toBe(425);
    expect(report.products[0].cost_source).toBe('VARIANT');
  });

  it('valúa con el costo congelado el producto vendido que no está en el catálogo', async () => {
    prisma.productCost.findMany.mockResolvedValue([]);
    /* Dos pedidos con costo distinto: el unitario sale del promedio real. */
    conVentas([
      articulo('Croqueta 2kg', 2, { sku: 'C-011' }, 90),
      articulo('Croqueta 2kg', 2, { sku: 'C-011' }, 100),
    ]);

    const report = await service.getInventoryCost(ctx, AGOSTO);

    expect(report.products[0]).toMatchObject({
      sku: 'C-011',
      unit_cost: 95,
      units_sold: 4,
      total_cost: 380,
      cogs_recorded: 380,
      in_catalog: false,
      cost_source: 'FROZEN',
    });
    expect(report.totals.products_in_catalog).toBe(0);
    expect(report.totals.products_listed).toBe(1);
  });

  it('deja sin costo al producto que nadie costeó y lo descuenta de la cobertura', async () => {
    prisma.productCost.findMany.mockResolvedValue([
      costo(85, { sku: 'A-100' }),
    ]);
    conVentas([
      articulo('Collar rojo', 30, { sku: 'A-100' }),
      articulo('Juguete nuevo', 10, { sku: 'Z-999' }),
    ]);

    const report = await service.getInventoryCost(ctx, AGOSTO);

    const sinCosto = report.products.find((p) => p.sku === 'Z-999')!;
    expect(sinCosto.unit_cost).toBeNull();
    expect(sinCosto.total_cost).toBeNull();
    expect(sinCosto.cost_source).toBeNull();
    /* Sin costo siempre al final, aunque haya vendido unidades. */
    expect(report.products[report.products.length - 1].sku).toBe('Z-999');
    expect(report.totals.products_without_cost).toBe(1);
    expect(report.totals.units_without_cost).toBe(10);
    expect(report.totals.cost_coverage).toBe(75);
    expect(report.totals.total_cost).toBe(2550);
  });

  it('separa la valuación al costo de hoy de lo que se cargó a resultados', async () => {
    prisma.productCost.findMany.mockResolvedValue([
      costo(100, { sku: 'A-100' }),
    ]);
    /* Se vendió cuando costaba 70; el catálogo ya lo subió a 100. */
    conVentas([articulo('Collar rojo', 10, { sku: 'A-100' }, 70)]);

    const report = await service.getInventoryCost(ctx, AGOSTO);

    expect(report.products[0].total_cost).toBe(1000);
    expect(report.products[0].cogs_recorded).toBe(700);
    expect(report.totals.total_cost).toBe(1000);
    expect(report.totals.cogs_recorded).toBe(700);
  });

  it('calcula los totales sobre el catálogo completo, no sobre la página', async () => {
    prisma.productCost.findMany.mockResolvedValue([
      costo(10, { sku: 'A' }),
      costo(20, { sku: 'B' }),
      costo(30, { sku: 'C' }),
    ]);
    conVentas([
      articulo('A', 1, { sku: 'A' }),
      articulo('B', 1, { sku: 'B' }),
      articulo('C', 1, { sku: 'C' }),
    ]);

    const report = await service.getInventoryCost(ctx, {
      ...AGOSTO,
      limit: 2,
      page: 2,
    });

    expect(report.products).toHaveLength(1);
    expect(report.products[0].sku).toBe('A');
    expect(report.total).toBe(3);
    expect(report.totals.total_cost).toBe(60);
  });

  it('sin periodo toma el mes en curso en la zona del negocio', async () => {
    /* 1 de septiembre a las 03:00 UTC: en CDMX todavía es 31 de agosto. */
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T03:00:00.000Z'));

    const report = await service.getInventoryCost(ctx, {});

    expect(report.period.start_date.toISOString()).toBe(
      '2026-08-01T06:00:00.000Z',
    );
    expect(report.period.end_date.toISOString()).toBe(
      '2026-09-01T05:59:59.999Z',
    );
  });

  it('rechaza un periodo a medias o mezclado', async () => {
    await expect(service.getInventoryCost(ctx, { year: 2026 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.getInventoryCost(ctx, { start_date: '2026-08-01' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getInventoryCost(ctx, {
        ...AGOSTO,
        start_date: '2026-08-01',
        end_date: '2026-08-31',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('filtra por dueño cuando el alcance es OWN y no lo hace cuando es ANY', async () => {
    await service.getInventoryCost(ctx, AGOSTO);
    expect(prisma.productCost.findMany.mock.calls[0][0].where).toMatchObject({
      user_id: 1,
    });
    expect(
      prisma.shopifyLineItem.findMany.mock.calls[0][0].where.shopify_order,
    ).toMatchObject({ shopify_connection: { user_id: 1 } });

    jest.clearAllMocks();
    prisma.productCost.findMany.mockResolvedValue([]);
    prisma.shopifyLineItem.findMany.mockResolvedValue([]);

    await service.getInventoryCost({ userId: 1, scope: 'ANY' }, AGOSTO);
    expect(
      prisma.shopifyLineItem.findMany.mock.calls[0][0].where.shopify_order,
    ).not.toHaveProperty('shopify_connection');
    expect(
      prisma.productCost.findMany.mock.calls[0][0].where,
    ).not.toHaveProperty('user_id');
  });
});
