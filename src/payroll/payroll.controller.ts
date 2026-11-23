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

  /*
   * Falla cerrado: sin `permissionScope` (guard roto) cae en OWN. `ownerUserId`
   * viene de `users.books_owner_id` (un socio ligado a otros libros); si no hay,
   * son los libros del propio usuario.
   */
  private ctxOf(user: { id: number }, request: any): OwnershipContext {
    return {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
      ownerUserId: request.booksOwnerId,
    };
  }

  @Post('generate')
  @RequirePermissions('payroll:create')
  generate(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: GeneratePayrollDto,
  ) {
    const ctx = this.ctxOf(user, request);
    return this.service.generate(ctx, dto);
  }

  @Post()
  @RequirePermissions('payroll:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreatePayrollPaymentDto,
  ) {
    const ctx = this.ctxOf(user, request);
    return this.service.createManual(ctx, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() filters: FilterPayrollDto,
  ) {
    const ctx = this.ctxOf(user, request);
    return this.service.findAll(ctx, filters);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(this.ctxOf(user, request), id);
  }

  @Patch(':id')
  @RequirePermissions('payroll:update')
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePayrollPaymentDto,
  ) {
    return this.service.update(this.ctxOf(user, request), id, dto);
  }

  @Post(':id/pay')
  @RequirePermissions('payroll:update')
  pay(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayPayrollDto,
  ) {
    return this.service.pay(this.ctxOf(user, request), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('payroll:delete')
  remove(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(this.ctxOf(user, request), id);
  }
}
