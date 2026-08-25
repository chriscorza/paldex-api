import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesByEmployeeService } from './sales-by-employee.service';
import { PrismaService } from '../prisma.service';

const Decimal = Prisma.Decimal;

const ctx = { userId: 1, scope: 'OWN' as const };

const LUIS = { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5], active: true };
const FELIX = { id: 2, name: 'Félix', sales_days: [6, 7], active: true };

/*
 * Agosto de 2026 en CDMX: el 3 es lunes y el 8 y 9 son sábado y domingo. Las
 * fechas van en UTC porque así las guarda la base de datos; la conversión a la
 * zona del negocio es justo lo que se está probando.
 */
const income = (
  id: number,
  isoDate: string,
  net: number,
  gross = net,
  costos: number[] = [],
) => ({
  id,
  date: new Date(isoDate),
  net_amount: new Decimal(net),
  gross_amount: new Decimal(gross),
  cogs: costos.map((c) => ({ total_cost: new Decimal(c) })),
});

describe('SalesByEmployeeService', () => {
  let service: SalesByEmployeeService;
  let prisma: any;

  const originalZone = process.env.REPORTS_TIMEZONE;

  beforeEach(async () => {
    process.env.REPORTS_TIMEZONE = 'America/Mexico_City';

    prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      income: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesByEmployeeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SalesByEmployeeService>(SalesByEmployeeService);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalZone === undefined) delete process.env.REPORTS_TIMEZONE;
    else process.env.REPORTS_TIMEZONE = originalZone;
  });

  const row = (report: any, name: string) =>
    report.rows.find((r: any) => r.employee_name === name);

  describe('reparto por turno', () => {
    it('da los días entre semana a uno y el fin de semana al otro', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // lunes
        income(2, '2026-08-06T18:00:00Z', 500), // jueves
        income(3, '2026-08-08T18:00:00Z', 700), // sábado
        income(4, '2026-08-09T18:00:00Z', 300), // domingo
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis')).toMatchObject({
        employee_id: 1,
        sales_days: [1, 2, 3, 4, 5],
        net_sales: 1500,
        sales_count: 2,
      });
      expect(row(report, 'Félix')).toMatchObject({
        employee_id: 2,
        sales_days: [6, 7],
        net_sales: 1000,
        sales_count: 2,
      });
      expect(row(report, 'unassigned').net_sales).toBe(0);
    });

    it('devuelve importes como números, no como cadenas', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1234.56, 1500.5),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').net_sales).toBe(1234.56);
      expect(row(report, 'Luis').gross_sales).toBe(1500.5);
      expect(typeof report.totals.net_sales).toBe('number');
    });

    it('no incluye a los empleados sin días asignados', async () => {
      prisma.employee.findMany.mockResolvedValue([
        LUIS,
        { id: 3, name: 'Contadora', sales_days: null, active: true },
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Contadora')).toBeUndefined();
      expect(report.rows).toHaveLength(2); // Luis + unassigned
    });

    it('suma los importes sin errores de coma flotante', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 0.1),
        income(2, '2026-08-04T18:00:00Z', 0.2),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').net_sales).toBe(0.3);
    });
  });

  describe('renglones en cero', () => {
    it('deja en ceros al empleado que no vendió nada en el periodo', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // sólo lunes
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Félix')).toMatchObject({
        net_sales: 0,
        gross_sales: 0,
        sales_count: 0,
      });
    });

    /*
     * `unassigned` es lo que hace comprobable el reporte: sin él, las ventas de
     * un día sin dueño desaparecerían del total sin dejar rastro.
     */
    it('devuelve unassigned aunque valga cero', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'unassigned')).toMatchObject({
        employee_id: null,
        sales_days: [],
        net_sales: 0,
        sales_count: 0,
      });
    });

    it('manda a unassigned las ventas de un día que nadie tiene', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 4, 5], active: true }, // sin miércoles
      ]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-05T18:00:00Z', 800), // miércoles
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').net_sales).toBe(0);
      expect(row(report, 'unassigned')).toMatchObject({
        net_sales: 800,
        sales_count: 1,
      });
    });
  });

  describe('cuadre de totales', () => {
    it('la suma de los renglones es igual al total de los ingresos', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000, 1100),
        income(2, '2026-08-08T18:00:00Z', 700, 780),
        income(3, '2026-08-05T18:00:00Z', 250, 300),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      const sumaRenglones = report.rows.reduce(
        (acc: number, r: any) => acc + r.net_sales,
        0,
      );

      expect(sumaRenglones).toBe(1950);
      expect(report.totals.net_sales).toBe(1950);
      expect(report.totals.gross_sales).toBe(2180);
      expect(report.totals.sales_count).toBe(3);
    });

    /*
     * `net_amount` es nullable y los ingresos manuales antiguos no lo traen. Se
     * suman como cero igual que en `getMonthlyAggregates`, o los dos reportes
     * dejarían de cuadrar, pero sí cuentan como venta.
     */
    it('trata como cero los importes nulos sin dejar de contarlos', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        {
          id: 1,
          date: new Date('2026-08-03T18:00:00Z'),
          net_amount: null,
          gross_amount: null,
          cogs: [],
        },
        income(2, '2026-08-04T18:00:00Z', 400, 450),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis')).toMatchObject({
        net_sales: 400,
        gross_sales: 450,
        sales_count: 2,
      });
    });

    /* Filtrar por `income_type` rompería el cuadre contra /reports/monthly. */
    it('no filtra por tipo de ingreso', async () => {
      await service.getSalesByEmployee(ctx, { year: 2026, month: 8 });

      const where = prisma.income.findMany.mock.calls[0][0].where;
      expect(where.income_type).toBeUndefined();
    });
  });

  describe('costo y utilidad', () => {
    it('resta a cada empleado el costo de lo que vendió', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000, 1000, [400]),
        income(2, '2026-08-04T18:00:00Z', 500, 500, [150, 50]),
        income(3, '2026-08-08T18:00:00Z', 700, 700, [300]),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis')).toMatchObject({
        net_sales: 1500,
        cogs: 600,
        gross_profit: 900,
      });
      expect(row(report, 'Félix')).toMatchObject({
        net_sales: 700,
        cogs: 300,
        gross_profit: 400,
      });
    });

    it('cuadra el total: utilidad = ventas netas − costo', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000, 1000, [400]),
        income(2, '2026-08-08T18:00:00Z', 700, 700, [300]),
      ]);

      const t = (
        await service.getSalesByEmployee(ctx, { year: 2026, month: 8 })
      ).totals;

      expect(t.cogs).toBe(700);
      expect(t.gross_profit).toBe(t.net_sales - t.cogs);
      expect(t.gross_profit).toBe(1000);
    });

    /*
     * Una venta sin costo capturado no resta nada y su utilidad sale completa.
     * No se descarta —el total dejaría de cuadrar con las ventas—, así que la
     * cobertura es la que avisa de que la cifra va inflada.
     */
    it('publica la cobertura cuando falta capturar costos', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000, 1000, [400]),
        income(2, '2026-08-04T18:00:00Z', 1000, 1000), // sin costo
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis')).toMatchObject({
        sales_count: 2,
        sales_with_cost: 1,
        cost_data_coverage: 50,
        cogs: 400,
        gross_profit: 1600,
      });
    });

    it('da cobertura 100 cuando todas las ventas traen costo', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000, 1000, [400]),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').cost_data_coverage).toBe(100);
    });

    /* Sin ventas no hay nada de qué calcular cobertura: null, no 0 ni 100. */
    it('deja la cobertura en null cuando no hubo ventas', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000, 1000, [400]),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Félix')).toMatchObject({
        sales_count: 0,
        cogs: 0,
        gross_profit: 0,
        cost_data_coverage: null,
      });
      expect(row(report, 'unassigned').cost_data_coverage).toBeNull();
    });

    it('no pierde centavos al restar el costo', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 0.3, 0.3, [0.1, 0.1]),
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').gross_profit).toBe(0.1);
    });
  });

  describe('zona horaria', () => {
    /*
     * El caso que motiva calcular el día en la zona del negocio: en UTC esta
     * venta ya es sábado y se le acreditaba al turno de fin de semana.
     */
    it('acredita la tarde del viernes al turno de entre semana', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-15T01:00:00Z', 2000), // viernes 19:00 en CDMX
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').net_sales).toBe(2000);
      expect(row(report, 'Félix').net_sales).toBe(0);
    });

    it('acredita la noche del domingo al turno de fin de semana', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-17T05:30:00Z', 900), // domingo 23:30 en CDMX
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Félix').net_sales).toBe(900);
      expect(row(report, 'Luis').net_sales).toBe(0);
    });
  });

  describe('rango del periodo', () => {
    it('sin parámetros toma el mes en curso en la zona del negocio', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-17T12:00:00Z'));

      const report = await service.getSalesByEmployee(ctx, {});

      expect(report.period.year).toBe(2026);
      expect(report.period.month).toBe(8);
      expect(report.period.start_date.toISOString()).toBe(
        '2026-08-01T06:00:00.000Z',
      );
      expect(report.period.end_date.toISOString()).toBe(
        '2026-09-01T05:59:59.999Z',
      );
    });

    /*
     * Con la zona del servidor —UTC en el contenedor— el día 1 antes de las
     * 06:00 el reporte ya habría saltado al mes siguiente.
     */
    it('el día 1 de madrugada sigue en el mes que acaba de empezar', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-01T08:00:00Z'));

      const report = await service.getSalesByEmployee(ctx, {});

      expect(report.period).toMatchObject({ year: 2026, month: 8 });
    });

    it('con year y month cubre ese mes entero', async () => {
      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 6,
      });

      expect(report.period.start_date.toISOString()).toBe(
        '2026-06-01T06:00:00.000Z',
      );
      expect(report.period.end_date.toISOString()).toBe(
        '2026-07-01T05:59:59.999Z',
      );
      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: {
              gte: new Date('2026-06-01T06:00:00.000Z'),
              lte: new Date('2026-07-01T05:59:59.999Z'),
            },
          }),
        }),
      );
    });

    it('rechaza year sin month', async () => {
      await expect(
        service.getSalesByEmployee(ctx, { year: 2026 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza month sin year', async () => {
      await expect(
        service.getSalesByEmployee(ctx, { month: 6 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('alcance de propiedad', () => {
    it('con alcance OWN acota empleados e ingresos al usuario', async () => {
      await service.getSalesByEmployee(ctx, { year: 2026, month: 8 });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: 1 }),
        }),
      );
      expect(prisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: 1 }),
        }),
      );
    });

    it('con alcance ANY no acota por dueño', async () => {
      await service.getSalesByEmployee(
        { userId: 1, scope: 'ANY' },
        { year: 2026, month: 8 },
      );

      const employeeWhere = prisma.employee.findMany.mock.calls[0][0].where;
      const incomeWhere = prisma.income.findMany.mock.calls[0][0].where;

      expect(employeeWhere.user_id).toBeUndefined();
      expect(incomeWhere.user_id).toBeUndefined();
    });

    /*
     * Un empleado inactivo ya no tiene turno: sus días quedan sin dueño. Antes
     * esto se comprobaba mirando el `where` del query; ahora los inactivos sí se
     * traen —para poder devolver el renglón de uno que se pidió por id— así que
     * se verifica el comportamiento, que es lo que de verdad importa.
     */
    it('no atribuye ventas a empleados inactivos', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5], active: false },
      ]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 500), // lunes, día de Luis
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'unassigned')).toMatchObject({
        net_sales: 500,
        sales_count: 1,
      });
      expect(row(report, 'Luis')).toBeUndefined();
    });
  });

  describe('periodo por rango', () => {
    it('acota a las fechas pedidas', async () => {
      await service.getSalesByEmployee(ctx, {
        start_date: '2026-08-10',
        end_date: '2026-08-16',
      });

      const where = prisma.income.findMany.mock.calls[0][0].where;
      expect(where.date.gte.toISOString()).toBe('2026-08-10T06:00:00.000Z');
      expect(where.date.lte.toISOString()).toBe('2026-08-17T05:59:59.999Z');
    });

    it('rechaza mezclar mes y rango', async () => {
      await expect(
        service.getSalesByEmployee(ctx, {
          year: 2026,
          month: 8,
          start_date: '2026-08-01',
          end_date: '2026-08-31',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza medio rango', async () => {
      await expect(
        service.getSalesByEmployee(ctx, { start_date: '2026-08-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un rango invertido', async () => {
      await expect(
        service.getSalesByEmployee(ctx, {
          start_date: '2026-08-16',
          end_date: '2026-08-10',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    /*
     * Deducir el mes de `start_date` haría que un 15-ene a 15-feb se anunciara
     * como enero: una respuesta equivocada dicha con seguridad.
     */
    it('sólo declara mes cuando el rango es exactamente ese mes', async () => {
      const mes = await service.getSalesByEmployee(ctx, {
        start_date: '2026-08-01',
        end_date: '2026-08-31',
      });
      expect(mes.period).toMatchObject({ year: 2026, month: 8 });

      const aCaballo = await service.getSalesByEmployee(ctx, {
        start_date: '2026-01-15',
        end_date: '2026-02-15',
      });
      expect(aCaballo.period).toMatchObject({ year: null, month: null });
      expect(aCaballo.period.start_date).toBeDefined();
    });

    it('declara el mes cuando se pide por year y month', async () => {
      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(report.period).toMatchObject({ year: 2026, month: 8 });
    });
  });

  describe('filtro de empleados', () => {
    const ventas = () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // lunes → Luis
        income(2, '2026-08-08T18:00:00Z', 400), // sábado → Félix
      ]);
    };

    it('devuelve sólo el empleado pedido', async () => {
      ventas();

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1],
      });

      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]).toMatchObject({ employee_id: 1, net_sales: 1000 });
    });

    it('devuelve varios cuando se piden varios', async () => {
      ventas();

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1, 2],
      });

      expect(report.rows.map((r: any) => r.employee_id).sort()).toEqual([1, 2]);
    });

    it('omite unassigned al filtrar, y lo devuelve si se pide', async () => {
      ventas();

      const sinPedirlo = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1],
      });
      expect(row(sinPedirlo, 'unassigned')).toBeUndefined();

      const pidiendolo = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1],
        include_unassigned: true,
      });
      expect(row(pidiendolo, 'unassigned')).toBeDefined();
    });

    it('sin filtro sigue trayendo a todos más unassigned', async () => {
      ventas();

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis')).toBeDefined();
      expect(row(report, 'Félix')).toBeDefined();
      expect(row(report, 'unassigned')).toBeDefined();
    });

    it('rechaza un id que no es de un empleado propio', async () => {
      ventas();

      await expect(
        service.getSalesByEmployee(ctx, {
          year: 2026,
          month: 8,
          employee_ids: [99],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    /*
     * El filtro se aplica después de repartir. Si acotara el query de ingresos,
     * los días de los no seleccionados caerían en `unassigned` y la cifra de
     * quien se pidió cambiaría según a quién más se hubiera pedido.
     */
    it('filtrar no reasigna ventas', async () => {
      ventas();
      const filtrado = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1],
      });

      ventas();
      const completo = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(filtrado.rows[0]).toEqual(row(completo, 'Luis'));
    });
  });

  describe('totales del filtro y del periodo', () => {
    const ventas = () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // lunes → Luis
        income(2, '2026-08-08T18:00:00Z', 400), // sábado → Félix
      ]);
    };

    it('sin filtro los dos bloques coinciden', async () => {
      ventas();

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(report.totals).toEqual(report.period_totals);
      expect(report.period_totals.net_sales).toBe(1400);
    });

    it('con filtro los totales se acotan pero el periodo queda entero', async () => {
      ventas();

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1],
      });

      expect(report.totals.net_sales).toBe(1000);
      expect(report.totals.sales_count).toBe(1);
      expect(report.period_totals.net_sales).toBe(1400);
      expect(report.period_totals.sales_count).toBe(2);
    });

    it('el total del periodo cuenta unassigned aunque no se devuelva', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // lunes → Luis
        income(2, '2026-08-08T18:00:00Z', 700), // sábado → nadie
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [1],
      });

      expect(row(report, 'unassigned')).toBeUndefined();
      expect(report.totals.net_sales).toBe(1000);
      expect(report.period_totals.net_sales).toBe(1700);
    });
  });

  describe('empleados inactivos', () => {
    /*
     * Un inactivo no tiene días, así que su renglón sale en ceros. Sin la
     * bandera ese cero se lee como «no vendió nada», cuando lo cierto es que sus
     * días ahora son de alguien más.
     */
    it('devuelve al inactivo que se pidió, marcado y en ceros', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5], active: true },
        { id: 3, name: 'Ana', sales_days: [], active: false },
      ]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // lunes → Luis
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
        employee_ids: [3],
      });

      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]).toMatchObject({
        employee_id: 3,
        active: false,
        net_sales: 0,
        sales_count: 0,
      });
    });

    it('sus días siguen contando para quien los tiene hoy', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5], active: true },
        { id: 3, name: 'Ana', sales_days: [1], active: false },
      ]);
      prisma.income.findMany.mockResolvedValue([
        income(1, '2026-08-03T18:00:00Z', 1000), // lunes
      ]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis')).toMatchObject({ net_sales: 1000 });
      expect(report.period_totals.net_sales).toBe(1000);
    });

    it('marca como activos a los que lo están', async () => {
      prisma.employee.findMany.mockResolvedValue([LUIS, FELIX]);

      const report = await service.getSalesByEmployee(ctx, {
        year: 2026,
        month: 8,
      });

      expect(row(report, 'Luis').active).toBe(true);
      expect(row(report, 'unassigned').active).toBe(true);
    });
  });
});
