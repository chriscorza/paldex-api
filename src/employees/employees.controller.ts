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
import { EmployeesService } from './employees.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  FilterEmployeesDto,
} from './dto/create-employee.dto';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
@RequirePermissions('employee:read')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() filters: FilterEmployeesDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findAll(ctx, filters);
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

  @Post()
  @RequirePermissions('employee:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreateEmployeeDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermissions('employee:update')
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employee:delete')
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

  @Get(':id/payments')
  findPayments(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('status') status?: string,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findPayments(ctx, id, startDate, endDate, status);
  }
}
