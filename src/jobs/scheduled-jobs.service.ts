import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { RecurringExpensesService } from '../recurring-expenses/recurring-expenses.service';
import { ShopifyReconciliationService } from '../shopify/shopify-reconciliation.service';
import { reportsTimeZone } from '../common/timezone';

/*
 * Cuánto hacia atrás y hacia adelante mira cada generación.
 *
 * Hacia adelante, para que los periodos aparezcan como PENDING antes de vencer:
 * 45 días cubren de sobra la frecuencia más larga que se genera sola (MENSUAL)
 * sin llenar la pantalla de vencimientos remotos.
 *
 * Hacia atrás es lo que hace que esto se repare solo. Ambas generaciones saltan
 * lo que ya existe —choque de índice único—, así que repetir un rango no cuesta
 * nada, y con una semana de solape un día de caída del contenedor no deja un
 * hueco permanente en la nómina. Sin esto, el periodo perdido sólo se recupera
 * a mano y nadie se entera hasta que falta el pago.
 */
const LOOKBACK_DAYS = 7;
const HORIZON_DAYS = 45;

/* Un día entero en ms, que es como se mueven las dos fechas de la ventana. */
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
    private readonly recurring: RecurringExpensesService,
    private readonly reconciliation: ShopifyReconciliationService,
  ) {}

  /*
   * A las 6 de la mañana en la zona del negocio: antes de que nadie abra la
   * app, y con el día ya empezado allí donde importa. La zona se pasa explícita
   * porque el contenedor corre en UTC —no tiene TZ— y sin ella "las 6" serían
   * la medianoche de CDMX.
   */
  @Cron('0 6 * * *', {
    name: 'generar-nomina',
    timeZone: reportsTimeZone(),
  })
  async generatePayroll(): Promise<void> {
    if (!this.enabled()) return;
    await this.forEachOwner('employee', 'nómina', (ctx, range) =>
      this.payroll.generate(ctx, range),
    );
  }

  /*
   * Cinco minutos después de la nómina. Van separadas porque son dos escrituras
   * largas contra la misma base y no hay razón para solaparlas.
   */
  @Cron('5 6 * * *', {
    name: 'generar-gastos-recurrentes',
    timeZone: reportsTimeZone(),
  })
  async generateRecurringExpenses(): Promise<void> {
    if (!this.enabled()) return;
    await this.forEachOwner(
      'recurringExpense',
      'gastos recurrentes',
      (ctx, range) => this.recurring.generate(ctx, range),
    );
  }

  /*
   * Cada hora. Es la red que recoge lo que el webhook no entregó: Shopify
   * reintenta un rato y se rinde, y sin esto la venta perdida no aparece nunca.
   * `reconcileAll` sólo mira desde `last_synced_at`, así que una corrida
   * frecuente es barata; espaciarla sólo alarga la ventana que revisa.
   */
  @Cron('20 * * * *', { name: 'reconciliar-shopify' })
  async reconcileShopify(): Promise<void> {
    if (!this.enabled()) return;
    try {
      const result = await this.reconciliation.reconcileAll();
      /*
       * Una discrepancia ya viene registrada por el reconciliador, con el id de
       * la transacción. Aquí sólo se resume, y en silencio cuando no hubo
       * ninguna: 24 líneas diarias de "todo bien" entierran las que importan.
       */
      if (result.discrepancies > 0) {
        this.logger.warn(
          `Reconciliación: ${result.discrepancies} discrepancias en ${result.connections} tiendas`,
        );
      }
    } catch (err) {
      this.logger.error('Falló la reconciliación de Shopify', err);
    }
  }

  /*
   * La generación escribe `user_id: ctx.userId` en lo que crea, así que un
   * contexto de scope 'ANY' colgaría los gastos de todas las cuentas del mismo
   * dueño. Se recorre dueño por dueño con scope 'OWN' para que cada fila nazca
   * de quien es.
   */
  private async forEachOwner(
    model: 'employee' | 'recurringExpense',
    label: string,
    run: (
      ctx: { userId: number; scope: 'OWN' },
      range: { start_date: string; end_date: string },
    ) => Promise<{ created: number; skipped: number }>,
  ): Promise<void> {
    const range = this.window();

    const owners = await (this.prisma[model] as any).findMany({
      distinct: ['user_id'],
      select: { user_id: true },
    });

    for (const { user_id } of owners as { user_id: number }[]) {
      try {
        const result = await run({ userId: user_id, scope: 'OWN' }, range);
        /*
         * Callado cuando no creó nada: el caso normal es que ya esté todo
         * generado de la corrida anterior.
         */
        if (result.created > 0) {
          this.logger.log(
            `Generación de ${label} para el usuario ${user_id}: ${result.created} creados, ${result.skipped} ya existían`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Falló la generación de ${label} para el usuario ${user_id}`,
          err,
        );
      }
    }
  }

  /*
   * Interruptor de emergencia: `SCHEDULED_JOBS_ENABLED=false` los apaga sin
   * tocar código. Se lee aquí y no al declarar el módulo porque `ConfigModule`
   * carga `.env.prod` en `process.env` después de que se evalúan los
   * decoradores — mirándolo antes, la variable de producción no existiría aún.
   *
   * Encendido salvo que se pida lo contrario: olvidar la variable al desplegar
   * y que la nómina deje de generarse en silencio es el fallo peor.
   */
  private enabled(): boolean {
    return process.env.SCHEDULED_JOBS_ENABLED !== 'false';
  }

  private window(): { start_date: string; end_date: string } {
    const now = Date.now();
    return {
      start_date: new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString(),
      end_date: new Date(now + HORIZON_DAYS * DAY_MS).toISOString(),
    };
  }
}
