import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DailySalesService } from './daily-sales.service';
import { PrismaService } from '../prisma.service';

const Decimal = Prisma.Decimal;

const ctx = { userId: 1, scope: 'OWN' as const };

/*
 * Las fechas van en UTC porque así las guarda la base; convertirlas a la zona
 * del negocio es justo lo que se está probando.
 */
const income = (
  isoDate: string,
  net: number,
  extra: Partial<{
    gross: number;
    discounts: number;
    fees: number;
    shipping: number;
  }> = {},
) => ({
  date: new Date(isoDate),
  net_amount: new Decimal(net),
  gross_amount: new Decimal(extra.gross ?? net),
  discount_total: new Decimal(extra.discounts ?? 0),
  fee_total: new Decimal(extra.fees ?? 0),
  shipping_charged: new Decimal(extra.shipping ?? 0),
});

describe('DailySalesService', () => {
  let service: DailySalesService;
  let prisma: any;

  const originalZone = process.env.REPORTS_TIMEZONE;

  beforeEach(async () => {
    process.env.REPORTS_TIMEZONE = 'America/Mexico_City';

    prisma = { income: { findMany: jest.fn().mockResolvedValue([]) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySalesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DailySalesService>(DailySalesService);
  });

  afterEach(() => {
    if (originalZone === undefined) delete process.env.REPORTS_TIMEZONE;
    else process.env.REPORTS_TIMEZONE = originalZone;
    jest.clearAllMocks();
  });

  describe('la serie', () => {
    it('devuelve un renglón por día, en orden ascendente', async () => {
      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-05',
      });

      expect(report.days.map((d) => d.date)).toEqual([
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
      ]);
    });

    it('los días sin ventas salen en cero, no se omiten', async () => {
      prisma.income.findMany.mockResolvedValue([
        income('2026-08-02T18:00:00Z', 100),
      ]);

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-03',
      });

      expect(report.days).toHaveLength(3);
      expect(report.days[0]).toMatchObject({
        date: '2026-08-01',
        net_sales: 0,
        sales_count: 0,
      });
      expect(report.days[1]).toMatchObject({
        date: '2026-08-02',
        net_sales: 100,
        sales_count: 1,
      });
      expect(report.days[2]).toMatchObject({
        date: '2026-08-03',
        net_sales: 0,
        sales_count: 0,
      });
    });

    it('suma varias ventas del mismo día', async () => {
      prisma.income.findMany.mockResolvedValue([
        income('2026-08-02T18:00:00Z', 100, { gross: 120, discounts: 20 }),
        income('2026-08-02T20:00:00Z', 50, { gross: 55, fees: 5 }),
      ]);

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-02',
        end_date: '2026-08-02',
      });

      expect(report.days[0]).toMatchObject({
        net_sales: 150,
        gross_sales: 175,
        discounts: 20,
        fees: 5,
        sales_count: 2,
      });
    });

    it('trata como cero los importes nulos', async () => {
      prisma.income.findMany.mockResolvedValue([
        {
          date: new Date('2026-08-02T18:00:00Z'),
          net_amount: null,
          gross_amount: null,
          discount_total: null,
          fee_total: null,
          shipping_charged: null,
        },
      ]);

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-02',
        end_date: '2026-08-02',
      });

      expect(report.days[0]).toMatchObject({ net_sales: 0, sales_count: 1 });
    });
  });

  describe('la zona horaria', () => {
    /*
     * Este es el test que falla si alguien reescribe el agrupado en SQL: con
     * `DATE(date)` la venta de las 19:00 se archiva en el día siguiente.
     */
    it('deja la venta de la tarde en su día local, no en el de UTC', async () => {
      // 19:00 del 5 de agosto en CDMX = 01:00 del 6 en UTC.
      prisma.income.findMany.mockResolvedValue([
        income('2026-08-06T01:00:00Z', 900),
      ]);

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-05',
        end_date: '2026-08-06',
      });

      expect(report.days[0]).toMatchObject({
        date: '2026-08-05',
        net_sales: 900,
        sales_count: 1,
      });
      expect(report.days[1]).toMatchObject({
        date: '2026-08-06',
        net_sales: 0,
        sales_count: 0,
      });
    });

    it('publica la zona con la que se agrupó', async () => {
      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-01',
      });

      expect(report.time_zone).toBe('America/Mexico_City');
    });
  });

  describe('los totales', () => {
    it('son la suma de los renglones', async () => {
      prisma.income.findMany.mockResolvedValue([
        income('2026-08-01T18:00:00Z', 100, { gross: 120, discounts: 20 }),
        income('2026-08-02T18:00:00Z', 50, { gross: 60, fees: 10 }),
        income('2026-08-02T19:00:00Z', 25, { gross: 25, shipping: 5 }),
      ]);

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-03',
      });

      const sum = (field: 'net_sales' | 'gross_sales' | 'sales_count') =>
        report.days.reduce((acc, d) => acc + d[field], 0);

      expect(report.totals.net_sales).toBe(sum('net_sales'));
      expect(report.totals.gross_sales).toBe(sum('gross_sales'));
      expect(report.totals.sales_count).toBe(sum('sales_count'));
      expect(report.totals.net_sales).toBe(175);
      expect(report.totals.discounts).toBe(20);
      expect(report.totals.fees).toBe(10);
      expect(report.totals.shipping_charged).toBe(5);
    });

    it('cuenta los días del rango y cuáles vendieron', async () => {
      prisma.income.findMany.mockResolvedValue([
        income('2026-08-02T18:00:00Z', 100),
      ]);

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-03',
      });

      expect(report.totals.days).toBe(3);
      expect(report.totals.days_with_sales).toBe(1);
    });

    it('no pierde centavos sumando muchos días', async () => {
      prisma.income.findMany.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) =>
          income(`2026-08-${String(i + 1).padStart(2, '0')}T18:00:00Z`, 10.1),
        ),
      );

      const report = await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-30',
      });

      expect(report.totals.net_sales).toBe(303);
    });
  });

  describe('la validación del rango', () => {
    it('rechaza un rango invertido', async () => {
      await expect(
        service.getDailySales(ctx, {
          start_date: '2026-08-10',
          end_date: '2026-08-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza más de 366 días en vez de recortar', async () => {
      await expect(
        service.getDailySales(ctx, {
          start_date: '2026-01-01',
          end_date: '2027-01-05',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.income.findMany).not.toHaveBeenCalled();
    });

    it('acepta el rango más largo permitido, 366 días', async () => {
      // 2026 no es bisiesto: del 1-ene-2026 al 1-ene-2027 son 366 días contados.
      const report = await service.getDailySales(ctx, {
        start_date: '2026-01-01',
        end_date: '2027-01-01',
      });

      expect(report.days).toHaveLength(366);
    });

    it('rechaza el día siguiente al tope', async () => {
      await expect(
        service.getDailySales(ctx, {
          start_date: '2026-01-01',
          end_date: '2027-01-02',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('la propiedad del dato', () => {
    it('filtra por dueño con scope OWN', async () => {
      await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-01',
      });

      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: 1 }),
        }),
      );
    });

    it('no filtra por dueño con scope ANY', async () => {
      await service.getDailySales(
        { userId: 1, scope: 'ANY' },
        { start_date: '2026-08-01', end_date: '2026-08-01' },
      );

      const where = prisma.income.findMany.mock.calls[0][0].where;
      expect(where.user_id).toBeUndefined();
    });

    /*
     * Filtrar por `income_type` rompería el cuadre contra
     * `GET /reports/monthly`, que tampoco lo filtra.
     */
    it('no filtra por income_type', async () => {
      await service.getDailySales(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-01',
      });

      const where = prisma.income.findMany.mock.calls[0][0].where;
      expect(where.income_type).toBeUndefined();
    });
  });
});
