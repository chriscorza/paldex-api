import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseIntPipe, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { PayablesService } from './payables.service';

@ApiTags('Payables')
@ApiBearerAuth()
@Controller('payables')
@RequirePermissions('payable:read')
export class PayablesController {
  constructor(private readonly service: PayablesService) {}

  @Get() findAll(@CurrentUser() u: { id: number }, @Req() r: any, @Query() q: any) {
    return this.service.findAll({ userId: u.id, scope: r.permissionScope || 'OWN' }, q);
  }
  @Get(':id') findOne(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne({ userId: u.id, scope: r.permissionScope || 'OWN' }, id);
  }
  @Post() @RequirePermissions('payable:create') create(@CurrentUser() u: { id: number }, @Req() r: any, @Body() d: any) {
    return this.service.create({ userId: u.id, scope: r.permissionScope || 'OWN' }, d);
  }
  @Patch(':id') @RequirePermissions('payable:update') update(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number, @Body() d: any) {
    return this.service.update({ userId: u.id, scope: r.permissionScope || 'OWN' }, id, d);
  }
  @Delete(':id') @RequirePermissions('payable:delete') remove(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove({ userId: u.id, scope: r.permissionScope || 'OWN' }, id);
  }
  @Post(':id/payments') @RequirePermissions('payable:update') addPayment(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number, @Body() d: any) {
    return this.service.addPayment({ userId: u.id, scope: r.permissionScope || 'OWN' }, id, d);
  }
  @Delete('payments/:id') @RequirePermissions('payable:update') removePayment(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.removePayment(id);
  }
}
