import { Controller, Get, Query, Req, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { ProfitEngine } from './profit-engine.service';
import { ReportsAggregationService } from './reports-aggregation.service';
import { ShopifyProfitabilityService } from './shopify-profitability.service';
import { ComparisonService } from './comparison.service';
import { MonthlyReportQueryDto } from './dto/report-query.dto';
import { ShopifyReportQueryDto } from './dto/shopify-report-query.dto';
import { BadRequestException } from '@nestjs/common';
import { LineItemProjectionService } from '../shopify/line-item-projection.service';

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

  @Post('shopify/recalculate-costs')
  async recalculateCosts(
    @Query('start_date') startDate: string,
    @Query('end_date') endDate: string,
  ) {
    return this.lineItemProjection.recalculateCosts(startDate, endDate);
  }

  @Get('compare')
  async compare(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query('periods') periods: string,
  ) {
    const ctx: OwnershipContext = { userId: user.id, scope: (request as any).permissionScope || 'OWN' };
    if (!periods) throw new BadRequestException('periods query param required (comma-separated YYYY-MM)');
    const parts = periods.split(',').map((p) => p.trim());
    const unique = [...new Set(parts)];
    if (unique.length !== parts.length) throw new BadRequestException('Duplicate periods not allowed');
    return this.comparisonService.compare(ctx, parts);
  }

  @Get('trends')
  async trends(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query('months') monthsStr: string,
  ) {
    const ctx: OwnershipContext = { userId: user.id, scope: (request as any).permissionScope || 'OWN' };
    const months = parseInt(monthsStr || '12', 10);
    return this.comparisonService.trends(ctx, months);
  }

  @Get('monthly/export')
  async exportMonthly(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: MonthlyReportQueryDto,
    @Query('format') format: string,
  ) {
    if (format === 'pdf') {
      throw new BadRequestException('PDF export not yet available. Use format=csv. See CLAUDE.md for details.');
    }
    return this.exportMonthlyCsv(user, request, query);
  }

  private async exportMonthlyCsv(user: any, request: any, query: MonthlyReportQueryDto) {
    const ctx: OwnershipContext = { userId: user.id, scope: (request as any).permissionScope || 'OWN' };
    const { startDate, endDate } = this.resolveDateRange(query);
    const aggregates = await this.aggregation.getMonthlyAggregates(ctx, startDate, endDate);
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
      const startDate = new Date(query.year!, query.month! - 1, 1);
      const endDate = new Date(query.year!, query.month!, 0, 23, 59, 59, 999);
      return { startDate, endDate };
    } else if (hasDates) {
      return {
        startDate: new Date(query.start_date!),
        endDate: new Date(query.end_date!),
      };
    } else {
      throw new BadRequestException(
        'Provide either year+month or start_date+end_date',
      );
    }
  }
}
