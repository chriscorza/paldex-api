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
  ) {}

  @Get('monthly')
  async monthly(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
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
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    return this.aggregation.getPayrollReport(ctx, startDate, endDate);
  }

  @Get('cash')
  async cash(@CurrentUser() user: { id: number }, @Req() request: any) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
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
    };
    const { startDate, endDate } = this.resolveDateRange(query);
    return this.aggregation.getSalesWithoutCost(ctx, startDate, endDate);
  }

  @Get('sales-by-employee')
  @ApiOperation({
    summary: 'Ventas del periodo atribuidas a cada empleado',
    description:
      'Reparte las ventas según el día de la semana que cada empleado tiene en ' +
      '`sales_days` —el día se calcula en la zona del negocio, no en UTC—. Sin ' +
      'parámetros devuelve el mes en curso; con `year` y `month`, cualquier mes ' +
      'anterior. Las ventas de los días que ningún empleado activo tiene ' +
      'asignados van al renglón `unassigned`, que aparece siempre para que la ' +
      'suma se pueda comparar con `GET /reports/monthly`. ' +
      'Incluye el costo de lo vendido y la utilidad bruta de cada turno, con ' +
      '`cost_data_coverage` diciendo de cuántas de esas ventas se conoce el ' +
      'costo: por debajo de 100 la utilidad es un techo, no una cifra firme. ' +
      'Es utilidad de producto, no descuenta sueldos ni gastos de la tienda. ' +
      'Ojo: no hay historial de turnos —un mes pasado se recalcula con la ' +
      'asignación de días vigente hoy, no con la que hubiera entonces.',
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
    };
    return this.inventoryCostService.getInventoryCost(ctx, query);
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
