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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateExpenseDto, PayExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { FilterExpensesDto } from './dto/filter-expenses.dto';
import { OwnershipContext } from '../common/ownership';

@ApiTags('expenses')
@ApiBearerAuth('jwt')
@Controller('expenses')
@RequirePermissions('expense:read')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @RequirePermissions('expense:create')
  create(
    @Req() request: any,
    @CurrentUser() user: any,
    @Body() dto: CreateExpenseDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.expensesService.create(ctx, dto);
  }

  @Get()
  findAll(
    @Req() request: any,
    @CurrentUser() user: any,
    @Query() filters: FilterExpensesDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.expensesService.findAll(ctx, filters);
  }

  @Get(':id')
  findOne(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.expensesService.findOne(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('expense:update')
  update(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExpenseDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.expensesService.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expense:delete')
  remove(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.expensesService.remove(ctx, id);
  }

  @Post(':id/pay')
  @RequirePermissions('expense:update')
  pay(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayExpenseDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.expensesService.pay(ctx, id, dto);
  }
}
