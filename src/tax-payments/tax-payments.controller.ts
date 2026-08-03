import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { TaxPaymentsService } from './tax-payments.service';
import {
  CreateTaxPaymentDto,
  PayTaxPaymentDto,
  UpdateTaxPaymentDto,
  FilterTaxPaymentsDto,
  TaxEstimateQueryDto,
} from './dto/tax-payment.dto';

@ApiTags('Tax Payments')
@ApiBearerAuth()
@Controller('tax-payments')
@RequirePermissions('tax_payment:read')
export class TaxPaymentsController {
  constructor(private readonly service: TaxPaymentsService) {}

  @Post()
  @RequirePermissions('tax_payment:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreateTaxPaymentDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.create(ctx, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() filters: FilterTaxPaymentsDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findAll(ctx, filters);
  }

  @Get('estimate')
  estimate(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: TaxEstimateQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.estimate(ctx, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findOne(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('tax_payment:update')
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaxPaymentDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tax_payment:delete')
  remove(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.remove(ctx, id);
  }

  @Post(':id/pay')
  @RequirePermissions('tax_payment:update')
  pay(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayTaxPaymentDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.pay(ctx, id, dto);
  }
}
