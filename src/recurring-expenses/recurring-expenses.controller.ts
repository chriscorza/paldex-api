import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseIntPipe, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { RecurringExpensesService } from './recurring-expenses.service';
import { CreateRecurringExpenseDto, UpdateRecurringExpenseDto, GenerateRecurringDto } from './dto/recurring-expense.dto';

@ApiTags('Recurring Expenses')
@ApiBearerAuth()
@Controller('recurring-expenses')
@RequirePermissions('recurring_expense:read')
export class RecurringExpensesController {
  constructor(private readonly service: RecurringExpensesService) {}

  @Get()
  findAll(@CurrentUser() user: { id: number }, @Req() request: any, @Query('page') page?: number, @Query('limit') limit?: number) {
    const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
    return this.service.findAll(ctx, page, limit);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { id: number }, @Req() request: any, @Param('id', ParseIntPipe) id: number) {
    const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
    return this.service.findOne(ctx, id);
  }

  @Post()
  @RequirePermissions('recurring_expense:create')
  create(@CurrentUser() user: { id: number }, @Req() request: any, @Body() dto: CreateRecurringExpenseDto) {
    const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
    return this.service.create(ctx, dto);
  }

  @Post('generate')
  @RequirePermissions('recurring_expense:create')
  generate(@CurrentUser() user: { id: number }, @Req() request: any, @Body() dto: GenerateRecurringDto) {
    const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
    return this.service.generate(ctx, dto);
  }

  @Patch(':id')
  @RequirePermissions('recurring_expense:update')
  update(@CurrentUser() user: { id: number }, @Req() request: any, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRecurringExpenseDto) {
    const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
    return this.service.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('recurring_expense:delete')
  remove(@CurrentUser() user: { id: number }, @Req() request: any, @Param('id', ParseIntPipe) id: number) {
    const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
    return this.service.remove(ctx, id);
  }
}
