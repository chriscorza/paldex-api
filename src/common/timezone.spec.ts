import {
  startOfDayInZone,
  endOfDayInZone,
  monthRangeInZone,
  currentMonthInZone,
  reportsTimeZone,
  weekdayInZone,
} from './timezone';

const CDMX = 'America/Mexico_City';

/*
 * El caso que motivó todo esto: contra el reporte de Shopify, que va en la zona
 * de la tienda, filtrar en UTC daba 6,785 de diferencia en un solo mes.
 */
describe('timezone — rangos de los reportes', () => {
  describe('startOfDayInZone', () => {
    it('toma la medianoche de la tienda, no la de UTC', () => {
      expect(startOfDayInZone('2026-07-01', CDMX).toISOString()).toBe(
        '2026-07-01T06:00:00.000Z',
      );
    });

    it('respeta una fecha que ya trae hora', () => {
      expect(startOfDayInZone('2026-07-01T09:30:00Z', CDMX).toISOString()).toBe(
        '2026-07-01T09:30:00.000Z',
      );
    });
  });

  describe('endOfDayInZone', () => {
    /* Tomar la medianoche del día final dejaba fuera ese día entero. */
    it('incluye el último día completo', () => {
      expect(endOfDayInZone('2026-07-31', CDMX).toISOString()).toBe(
        '2026-08-01T05:59:59.999Z',
      );
    });
  });

  describe('monthRangeInZone', () => {
    it('cubre el mes de punta a punta en la zona de la tienda', () => {
      const { startDate, endDate } = monthRangeInZone(2026, 7, CDMX);

      expect(startDate.toISOString()).toBe('2026-07-01T06:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-08-01T05:59:59.999Z');
    });

    it('conoce la longitud de cada mes', () => {
      expect(monthRangeInZone(2026, 2, CDMX).endDate.toISOString()).toBe(
        '2026-03-01T05:59:59.999Z',
      );
      expect(monthRangeInZone(2028, 2, CDMX).endDate.toISOString()).toBe(
        '2028-03-01T05:59:59.999Z',
      );
    });

    it('no deja hueco ni solapa entre un mes y el siguiente', () => {
      const julio = monthRangeInZone(2026, 7, CDMX);
      const agosto = monthRangeInZone(2026, 8, CDMX);

      expect(agosto.startDate.getTime() - julio.endDate.getTime()).toBe(1);
    });
  });

  /*
   * México ya no cambia la hora, pero el helper no puede darlo por hecho: el
   * desplazamiento se mide en el instante concreto, no en la zona.
   */
  describe('zonas con horario de verano', () => {
    it('usa el desplazamiento vigente en cada fecha', () => {
      const invierno = startOfDayInZone('2026-01-15', 'Europe/Madrid');
      const verano = startOfDayInZone('2026-07-15', 'Europe/Madrid');

      expect(invierno.toISOString()).toBe('2026-01-14T23:00:00.000Z');
      expect(verano.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    });
  });

  /*
   * El día 1 de cada mes, entre las 00:00 y las 06:00 UTC, el negocio todavía
   * está en el mes anterior. Con `new Date().getMonth()` el dashboard ya se
   * había pasado al siguiente y mostraba un mes recién empezado como actual.
   */
  describe('currentMonthInZone', () => {
    afterEach(() => jest.useRealTimers());

    it('sigue en el mes anterior mientras la tienda no ha cambiado de mes', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-01T03:00:00Z'));

      expect(currentMonthInZone(CDMX)).toEqual({ year: 2026, month: 7 });
    });

    it('cambia de mes cuando la tienda cambia', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-01T06:00:00Z'));

      expect(currentMonthInZone(CDMX)).toEqual({ year: 2026, month: 8 });
    });

    it('cruza bien el año', () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-01-01T03:00:00Z'));

      expect(currentMonthInZone(CDMX)).toEqual({ year: 2026, month: 12 });
    });
  });

  describe('weekdayInZone', () => {
    /*
     * El caso que obliga a no usar `getDay()`: con el turno de lunes a viernes
     * de una persona y el de fin de semana de otra, esta venta se le acreditaba
     * a quien no la hizo.
     */
    it('la tarde del viernes sigue siendo viernes aunque en UTC ya sea sábado', () => {
      const viernesPorLaNoche = new Date('2026-08-15T01:00:00Z');

      expect(weekdayInZone(viernesPorLaNoche, CDMX)).toBe(5);
      expect(weekdayInZone(viernesPorLaNoche, 'UTC')).toBe(6);
    });

    it('la noche del domingo sigue siendo domingo aunque en UTC ya sea lunes', () => {
      const domingoPorLaNoche = new Date('2026-08-17T05:30:00Z');

      expect(weekdayInZone(domingoPorLaNoche, CDMX)).toBe(7);
      expect(weekdayInZone(domingoPorLaNoche, 'UTC')).toBe(1);
    });

    it('numera los días en ISO: 1 es lunes y 7 es domingo', () => {
      const lunes = new Date('2026-08-17T18:00:00Z');

      expect(weekdayInZone(lunes, CDMX)).toBe(1);
      expect(weekdayInZone(new Date('2026-08-16T18:00:00Z'), CDMX)).toBe(7);
    });

    /*
     * México dejó el horario de verano en 2022, así que CDMX vale -6 todo el
     * año: la medianoche cae en el mismo instante UTC en enero y en julio.
     */
    it('no desplaza el día en una zona sin horario de verano', () => {
      expect(weekdayInZone(new Date('2026-01-15T06:00:00Z'), CDMX)).toBe(4);
      expect(weekdayInZone(new Date('2026-07-15T06:00:00Z'), CDMX)).toBe(3);
    });

    /*
     * Donde sí hay horario de verano, el desplazamiento se mide sobre cada
     * instante: los dos caen en lunes de madrugada en Madrid —uno con +1 y otro
     * con +2— aunque en UTC los dos sean domingo.
     */
    it('aplica el desplazamiento vigente en ese instante, no uno fijo', () => {
      const invierno = new Date('2026-01-11T23:30:00Z');
      const verano = new Date('2026-07-12T22:30:00Z');

      expect(weekdayInZone(invierno, 'Europe/Madrid')).toBe(1);
      expect(weekdayInZone(verano, 'Europe/Madrid')).toBe(1);
      expect(weekdayInZone(invierno, 'UTC')).toBe(7);
      expect(weekdayInZone(verano, 'UTC')).toBe(7);
    });

    it('cae en la zona del negocio cuando no se le pasa una', () => {
      expect(weekdayInZone(new Date('2026-08-15T01:00:00Z'))).toBe(5);
    });
  });

  describe('reportsTimeZone', () => {
    const original = process.env.REPORTS_TIMEZONE;
    afterEach(() => {
      if (original === undefined) delete process.env.REPORTS_TIMEZONE;
      else process.env.REPORTS_TIMEZONE = original;
    });

    it('cae en la zona del negocio cuando no se configura', () => {
      delete process.env.REPORTS_TIMEZONE;
      expect(reportsTimeZone()).toBe(CDMX);
    });

    it('se puede cambiar por entorno', () => {
      process.env.REPORTS_TIMEZONE = 'Europe/Madrid';
      expect(reportsTimeZone()).toBe('Europe/Madrid');
    });
  });
});
