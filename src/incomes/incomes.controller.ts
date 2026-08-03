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
import { IncomesService } from './incomes.service';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateIncomeDto } from './dto/create-income.dto';
import { UpdateIncomeDto } from './dto/update-income.dto';
import { FilterIncomesDto } from './dto/filter-incomes.dto';
import { OwnershipContext } from '../common/ownership';

@ApiTags('incomes')
@ApiBearerAuth('jwt')
@Controller('incomes')
@RequirePermissions('income:read')
export class IncomesController {
  constructor(private readonly incomesService: IncomesService) {}

  @Post()
  @RequirePermissions('income:create')
  create(
    @Req() request: any,
    @CurrentUser() user: any,
    @Body() dto: CreateIncomeDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.incomesService.create(ctx, dto);
  }

  @Get()
  findAll(
    @Req() request: any,
    @CurrentUser() user: any,
    @Query() filters: FilterIncomesDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.incomesService.findAll(ctx, filters);
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
    return this.incomesService.findOne(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('income:update')
  update(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIncomeDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.incomesService.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('income:delete')
  remove(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.incomesService.remove(ctx, id);
  }
}
