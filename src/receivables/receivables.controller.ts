import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseIntPipe, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { ReceivablesService } from './receivables.service';

@ApiTags('Receivables')
@ApiBearerAuth()
@Controller('receivables')
@RequirePermissions('receivable:read')
export class ReceivablesController {
  constructor(private readonly service: ReceivablesService) {}
  @Get() findAll(@CurrentUser() u: { id: number }, @Req() r: any, @Query() q: any) { return this.service.findAll({ userId: u.id, scope: r.permissionScope || 'OWN' }, q); }
  @Get(':id') findOne(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number) { return this.service.findOne({ userId: u.id, scope: r.permissionScope || 'OWN' }, id); }
  @Post() @RequirePermissions('receivable:create') create(@CurrentUser() u: { id: number }, @Req() r: any, @Body() d: any) { return this.service.create({ userId: u.id, scope: r.permissionScope || 'OWN' }, d); }
  @Patch(':id') @RequirePermissions('receivable:update') update(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number, @Body() d: any) { return this.service.update({ userId: u.id, scope: r.permissionScope || 'OWN' }, id, d); }
  @Delete(':id') @RequirePermissions('receivable:delete') remove(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number) { return this.service.remove({ userId: u.id, scope: r.permissionScope || 'OWN' }, id); }
  @Post(':id/collections') @RequirePermissions('receivable:update') addCollection(@CurrentUser() u: { id: number }, @Req() r: any, @Param('id', ParseIntPipe) id: number, @Body() d: any) { return this.service.addCollection({ userId: u.id, scope: r.permissionScope || 'OWN' }, id, d); }
}
