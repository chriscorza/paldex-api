import { Controller, Get, Query, Req, Post, Body, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { ProfitEngine } from './profit-engine.service';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ShopifyProfitabilityService } from './shopify-profitability.service';
import { ComparisonService } from './comparison.service';
import { MonthlyReportQueryDto } from './dto/report-query.dto';
import { ShopifyReportQueryDto } from './dto/shopify-report-query.dto';
import { SalesByEmployeeQueryDto } from './dto/sales-by-employee-query.dto';
import { SalesByEmployeeService } from './sales-by-employee.service';
import { SalesByEmployeeReportEntity } from './entities/sales-by-employee.entity';
import { InventoryCostService } from './inventory-cost.service';
import { InventoryCostQueryDto } from './dto/inventory-cost-query.dto';
import { InventoryCostReportEntity } from './entities/inventory-cost.entity';
import { DailySalesService } from './daily-sales.service';
import { DailySalesQueryDto } from './dto/daily-sales-query.dto';
import { DailySalesReportEntity } from './entities/daily-sales.entity';
import { IncomeStatementService } from './income-statement.service';
import { IncomeStatementPdfService } from './income-statement-pdf.service';
import {
  IncomeStatementExportQueryDto,
  IncomeStatementQueryDto,
} from './dto/income-statement-query.dto';
import { IncomeStatementEntity } from './entities/income-statement.entity';
import { InventoryValuationService } from '../inventory/inventory-valuation.service';
import { InventoryValuationQueryDto } from '../inventory/dto/inventory-valuation-query.dto';
import { InventoryValuationReportEntity } from '../inventory/entities/inventory-valuation.entity';
import { BadRequestException } from '@nestjs/common';
import { LineItemProjectionService } from '../shopify/line-item-projection.service';
import { escapeCsvField } from '../common/csv';
import {
  endOfDayInZone,
  monthRangeInZone,
  startOfDayInZone,
} from '../common/timezone';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@RequirePermissions('report:read')
export class ReportsController {
  constructor(
    private readonly aggregation: ReportsAggregationService,
    private readonly engine: ProfitEngine,
    private readonly shopifyService: ShopifyProfitabilityService,
    private readonly comparisonService: ComparisonService,
    private readonly lineItemProjection: LineItemProjectionService,
    private readonly salesByEmployeeService: SalesByEmployeeService,
    private readonly inventoryCostService: InventoryCostService,
    private readonly inventoryValuationService: InventoryValuationService,
    private readonly dailySalesService: DailySalesService,
    private readonly incomeStatementService: IncomeStatementService,
    private readonly incomeStatementPdfService: IncomeStatementPdfService,
  ) {}

  @Get('income-statement')
  @ApiOperation({
    summary: 'Estado de resultados (P&L) con EBITDA, por rango de fechas',
    description:
      'Base de efectivo, como `GET /reports/monthly`. Ventas netas − costo de ventas = ' +
      'utilidad bruta; − gastos de operación − nómina (neto pagado + PAYROLL_TAX) = EBITDA; ' +
      '− depreciación y amortización (activos fijos) = EBIT; − intereses ± baja de activos = ' +
      'utilidad antes de impuestos; − ISR = utilidad neta. ' +
      'El IVA, las compras de activos (CAPEX) e inventario, el pago de capital y los movimientos ' +
      'del dueño no son gasto: van en `cash_items`. ' +
      'Rango obligatorio, sin periodo por omisión, de hasta 366 días. ' +
      'Ventas netas y COGS cuadran con `GET /reports/monthly` para el mismo mes; su utilidad ' +
      'neta no, porque aquél resta el IVA como impuesto.',
  })
  @ApiOkResponse({ type: IncomeStatementEntity })
  async incomeStatement(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: IncomeStatementQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.incomeStatementService.getIncomeStatement(ctx, query);
  }

  @Get('income-statement/export')
  @ApiOperation({
    summary: 'Exportar el estado de resultados a CSV o PDF',
    description:
      '`format=csv` (por omisión): los mismos renglones que `GET /reports/income-statement`, ' +
      'aplanados. `format=pdf`: el documento para imprimir o mandar al contador, con ' +
      'resumen, cascada con % sobre ventas, movimientos que no son gasto, avisos y glosario.',
  })
  async exportIncomeStatement(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Res() res: any,
    @Query() query: IncomeStatementExportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const statement = await this.incomeStatementService.getIncomeStatement(
      ctx,
      { start_date: query.start_date, end_date: query.end_date },
    );
    const filename = `estado-de-resultados-${statement.period.start_date}_${statement.period.end_date}`;

    if (query.format === 'pdf') {
      const pdf = await this.incomeStatementPdfService.render(statement, {
        businessName: await this.incomeStatementService.businessName(ctx),
        generatedAt: new Date(),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.pdf"`,
      );
      res.send(pdf);
      return;
    }

    const csv = this.incomeStatementService
      .toCsvRows(statement)
      .map((row) => row.map((field) => escapeCsvField(field)).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}.csv"`,
    );
    res.send(csv);
  }

  @Get('sales-daily')
  @ApiOperation({
    summary: 'Ventas día por día en un rango',
    description:
      'Un renglón por día del rango, con `net_sales`, `gross_sales`, ' +
      'descuentos, comisiones, envío cobrado y número de ventas, más los ' +
      'totales del rango completo. ' +
      'El día es el de la tienda, no el de UTC: una venta de las 19:00 en CDMX ' +
      'cuenta en ese día aunque en UTC ya sea el siguiente. ' +
      'Los días sin ventas salen en cero y nunca se omiten, para que no se ' +
      'confunda «no vendió nada» con «no hay dato». ' +
      'El rango es obligatorio —no hay «mes en curso» por defecto— y no puede ' +
      'pasar de 366 días: un rango mayor se rechaza en vez de recortarse. ' +
      'La suma de los días de un mes cuadra con `net_sales` de ' +
      '`GET /reports/monthly`.',
  })
  @ApiOkResponse({ type: DailySalesReportEntity })
  async salesDaily(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: DailySalesQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.dailySalesService.getDailySales(ctx, query);
  }

  @Get('monthly')
  async monthly(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    const aggregates = await this.aggregation.getMonthlyAggregates(
      ctx,
      startDate,
      endDate,
    );
    return this.engine.calculate(aggregates);
  }

  @Get('monthly/expenses-breakdown')
  async expensesBreakdown(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    const prevStart = new Date(startDate);
    prevStart.setMonth(prevStart.getMonth() - 1);
    const prevEnd = new Date(endDate);
    prevEnd.setMonth(prevEnd.getMonth() - 1);

    return this.aggregation.getExpensesBreakdown(
      ctx,
      startDate,
      endDate,
      prevStart,
      prevEnd,
    );
  }

  @Get('monthly/fiscal')
  async fiscal(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    return this.aggregation.getFiscalReport(ctx, startDate, endDate);
  }

  @Get('monthly/payroll')
  async payroll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    return this.aggregation.getPayrollReport(ctx, startDate, endDate);
  }

  @Get('cash')
  async cash(@CurrentUser() user: { id: number }, @Req() request: any) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.aggregation.getCashReport(ctx);
  }

  @Get('sales-without-cost')
  async salesWithoutCost(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    return this.aggregation.getSalesWithoutCost(ctx, startDate, endDate);
  }

  @Get('sales-by-employee')
  @ApiOperation({
    summary: 'Ventas del periodo atribuidas a cada empleado',
    description:
      'Reparte las ventas según el día de la semana que cada empleado tiene en ' +
      '`sales_days` —el día se calcula en la zona del negocio, no en UTC—. ' +
      'El periodo se pide con `year`+`month` o con `start_date`+`end_date`, no ' +
      'con ambos; sin nada, el mes en curso. `period.year`/`period.month` sólo ' +
      'se llenan cuando el periodo es exactamente un mes de calendario. ' +
      'Con `employee_ids` se acota a una persona o a varias; sin él van todas. ' +
      'Las ventas de los días que ningún empleado activo tiene asignados van al ' +
      'renglón `unassigned`, que aparece siempre salvo que se filtre por ' +
      'empleado (se recupera con `include_unassigned`). ' +
      '`totals` suma los renglones devueltos y `period_totals` el periodo ' +
      'completo se haya filtrado o no: es lo que deja comparar contra ' +
      '`GET /reports/monthly` incluso al filtrar, y lo que dice si ese ' +
      '«Luis: 40,000» es casi todo el periodo o una migaja. ' +
      'Incluye el costo de lo vendido y la utilidad bruta de cada turno, con ' +
      '`cost_data_coverage` diciendo de cuántas de esas ventas se conoce el ' +
      'costo: por debajo de 100 la utilidad es un techo, no una cifra firme. ' +
      'Es utilidad de producto, no descuenta sueldos ni gastos de la tienda. ' +
      'Un empleado inactivo no tiene días asignados, así que sale en ceros: por ' +
      'eso cada renglón trae `active`, para que ese cero no se lea como «no ' +
      'vendió nada» cuando sus días ya son de alguien más. ' +
      'Ojo: no hay historial de turnos —el periodo se recalcula con la ' +
      'asignación de días vigente hoy, no con la que hubiera entonces—. Con ' +
      'rangos esto pesa más: un rango que cruza una reasignación reporta todo ' +
      'el tramo bajo los dueños de hoy, así que `sales_days` va en cada renglón ' +
      'para ver con qué asignación se calculó la cifra.',
  })
  @ApiOkResponse({ type: SalesByEmployeeReportEntity })
  async salesByEmployee(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: SalesByEmployeeQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.salesByEmployeeService.getSalesByEmployee(ctx, query);
  }

  @Get('inventory-cost')
  @ApiOperation({
    summary: 'Costo del inventario por producto',
    description:
      'El catálogo de costos completo —todo lo que tenga renglón en ' +
      '`ProductCost`, se haya vendido o no— cruzado con las unidades vendidas ' +
      'del periodo: costo unitario vigente, unidades y costo total, de mayor a ' +
      'menor. Sin parámetros toma el mes en curso; acepta `year`+`month` o ' +
      '`start_date`+`end_date`. Los productos vendidos que nadie costeó también ' +
      'salen, con el costo que Shopify congeló en la venta o sin costo, y ' +
      '`cost_coverage` dice qué parte de las unidades quedó valuada. ' +
      'Ojo con dos cosas: no es un avalúo de existencias —el esquema no guarda ' +
      'cuántas piezas hay, así que se valúa lo vendido, no lo que queda— y no ' +
      'es el COGS del reporte mensual, que se fecha por cobro y sale de ' +
      '`CostOfGoodsSold`; para comparar contra los libros está `cogs_recorded`.',
  })
  @ApiOkResponse({ type: InventoryCostReportEntity })
  async inventoryCost(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: InventoryCostQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.inventoryCostService.getInventoryCost(ctx, query);
  }

  @Get('inventory-valuation')
  @ApiOperation({
    summary: 'Avalúo del inventario en existencia',
    description:
      'Cuánto vale la mercancía que está en el anaquel: por producto, piezas ' +
      'en existencia × costo unitario, de mayor a menor. Lee la foto más ' +
      'reciente tomada con `POST /inventory/snapshots` —o la que se indique con ' +
      '`snapshot_id`, o la vigente a una fecha con `as_of`—, nunca consulta ' +
      'Shopify en vivo. ' +
      'No confundir con `GET /reports/inventory-cost`, que valúa lo *vendido* ' +
      'en un periodo: éste valúa lo que *queda*. ' +
      'No es costeo PEPS ni promedio ponderado: valúa al costo vigente, así ' +
      'que un alza revalúa mercancía comprada barata. `cost_coverage` dice qué ' +
      'parte de las piezas quedó valuada; por debajo de 100 el total es un piso.',
  })
  @ApiOkResponse({ type: InventoryValuationReportEntity })
  async inventoryValuation(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: InventoryValuationQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.inventoryValuationService.getValuation(ctx, query);
  }

  @Get('shopify/category-profitability')
  async shopifyCategory(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: ShopifyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.shopifyService.getCategoryProfitability(ctx, query);
  }

  @Get('shopify/product-profitability')
  async shopifyProduct(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: ShopifyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.shopifyService.getProductProfitability(ctx, query);
  }

  @Get('shopify/channel-profitability')
  async shopifyChannel(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: ShopifyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.shopifyService.getChannelProfitability(ctx, query);
  }

  @Get('shopify/orders-without-income')
  @ApiOperation({
    summary: 'Pedidos de Shopify sin ningún cobro registrado',
    description:
      'La conciliación contra el reporte de ventas de Shopify: lista los pedidos ' +
      'del periodo que no generaron ningún ingreso —pendientes de pago, ' +
      'autorizados sin capturar o cobrados fuera de Shopify— porque son la ' +
      'diferencia entre lo que reporta Shopify y lo que suma paldex.',
  })
  async shopifyOrdersWithoutIncome(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: ShopifyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.shopifyService.getOrdersWithoutIncome(ctx, query);
  }

  @Post('shopify/recalculate-costs')
  async recalculateCosts(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query('start_date') startDate: string,
    @Query('end_date') endDate: string,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    return this.lineItemProjection.recalculateCosts(startDate, endDate, ctx);
  }

  @Get('compare')
  async compare(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query('periods') periods: string,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    if (!periods)
      throw new BadRequestException(
        'periods query param required (comma-separated YYYY-MM)',
      );
    const parts = periods.split(',').map((p) => p.trim());
    const unique = [...new Set(parts)];
    if (unique.length !== parts.length)
      throw new BadRequestException('Duplicate periods not allowed');
    return this.comparisonService.compare(ctx, parts);
  }

  @Get('trends')
  async trends(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query('months') monthsStr: string,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const months = parseInt(monthsStr || '12', 10);
    return this.comparisonService.trends(ctx, months);
  }

  @Get('monthly/export')
  async exportMonthly(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Res() res: any,
    @Query() query: MonthlyReportQueryDto,
    @Query('format') format: string,
  ) {
    if (format === 'pdf') {
      throw new BadRequestException(
        'PDF export not yet available. Use format=csv.',
      );
    }
    if (format !== 'csv') {
      return this.exportMonthlyCsv(user, request, query);
    }
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    const aggregates = await this.aggregation.getMonthlyAggregates(
      ctx,
      startDate,
      endDate,
    );
    const report = this.engine.calculate(aggregates);

    const headers = [
      'net_sales',
      'gross_sales',
      'discounts_total',
      'fees_total',
      'shipping_charged',
      'shipping_cost',
      'cogs',
      'gross_profit',
      'gross_margin',
      'operating_expenses',
      'payroll_paid',
      'calculated_operating_expenses',
      'operating_profit',
      'operating_margin',
      'taxes_paid',
      'net_profit',
      'net_margin',
      'inventory_purchases',
      'owner_withdrawals',
      'reinvestment',
      'debt_principal_paid',
      'sales_without_cost',
      'cost_data_coverage',
      'gross_profit_confirmed',
      'gross_profit_purchase_basis',
      'incomplete_cost_data',
      'pending_expenses',
      'pending_payroll',
      'pending_taxes',
      'projected_net_profit',
    ];

    const row = headers.map((h) => {
      if (h.startsWith('pending_') || h.startsWith('projected_')) {
        const val = (report.projection as any)[h] ?? null;
        return escapeCsvField(val);
      }
      if (
        [
          'sales_without_cost',
          'cost_data_coverage',
          'gross_profit_confirmed',
          'gross_profit_purchase_basis',
          'incomplete_cost_data',
        ].includes(h)
      ) {
        const val = (report.quality as any)[h] ?? null;
        return escapeCsvField(h === 'incomplete_cost_data' ? String(val) : val);
      }
      return escapeCsvField((report as any)[h]);
    });

    const csv = [headers.join(','), row.join(',')].join('\n');

    const yearMonth =
      query.year && query.month
        ? `${query.year}-${String(query.month).padStart(2, '0')}`
        : 'custom';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte-mensual-${yearMonth}.csv"`,
    );
    res.send(csv);
  }

  private async exportMonthlyCsv(
    user: any,
    request: any,
    query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
      ownerUserId: (request as any).booksOwnerId,
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    const aggregates = await this.aggregation.getMonthlyAggregates(
      ctx,
      startDate,
      endDate,
    );
    const report = this.engine.calculate(aggregates);
    return report;
  }

  private resolveDateRange(query: MonthlyReportQueryDto): {
    startDate: Date;
    endDate: Date;
  } {
    const hasYearMonth = query.year !== undefined && query.month !== undefined;
    const hasDates =
      query.start_date !== undefined && query.end_date !== undefined;

    if (hasYearMonth && hasDates) {
      throw new BadRequestException(
        'Use either year+month or start_date+end_date, not both',
      );
    }

    if (hasYearMonth) {
      if (query.month! < 1 || query.month! > 12) {
        throw new BadRequestException('Month must be between 1 and 12');
      }
      /*
       * `new Date(año, mes, día)` construía el rango en la zona del servidor
       * —UTC dentro del contenedor— y el de fechas sueltas lo hacía en UTC
       * siempre. Los dos caminos ya usan la zona del negocio.
       */
      return monthRangeInZone(query.year!, query.month!);
    } else if (hasDates) {
      return {
        startDate: startOfDayInZone(query.start_date!),
        endDate: endOfDayInZone(query.end_date!),
      };
    } else {
      throw new BadRequestException(
        'Provide either year+month or start_date+end_date',
      );
    }
  }
}
