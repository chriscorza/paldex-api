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
import { PayrollService } from './payroll.service';
import {
  GeneratePayrollDto,
  CreatePayrollPaymentDto,
  PayPayrollDto,
  UpdatePayrollPaymentDto,
  FilterPayrollDto,
} from './dto/payroll.dto';

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
@RequirePermissions('payroll:read')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Post('generate')
  @RequirePermissions('payroll:create')
  generate(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: GeneratePayrollDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.generate(ctx, dto);
  }

  @Post()
  @RequirePermissions('payroll:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreatePayrollPaymentDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.createManual(ctx, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() filters: FilterPayrollDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findAll(ctx, filters);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('payroll:update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePayrollPaymentDto,
  ) {
    return this.service.update(id, dto);
  }

  @Post(':id/pay')
  @RequirePermissions('payroll:update')
  pay(@Param('id', ParseIntPipe) id: number, @Body() dto: PayPayrollDto) {
    return this.service.pay(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('payroll:delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
