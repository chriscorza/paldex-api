import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
  FilterExpenseCategoriesDto,
} from './dto/create-expense-category.dto';

@ApiTags('Expense Categories')
@ApiBearerAuth()
@Controller('expense-categories')
@RequirePermissions('expense_category:read')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: Request,
    @Query() filters: FilterExpenseCategoriesDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
    };
    return this.service.findAll(ctx, filters);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { id: number },
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
    };
    return this.service.findOne(ctx, id);
  }

  @Post()
  @RequirePermissions('expense_category:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: Request,
    @Body() dto: CreateExpenseCategoryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
    };
    return this.service.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermissions('expense_category:update')
  update(
    @CurrentUser() user: { id: number },
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
    };
    return this.service.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expense_category:delete')
  remove(
    @CurrentUser() user: { id: number },
    @Req() request: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: (request as any).permissionScope || 'OWN',
    };
    return this.service.remove(ctx, id);
  }
}
