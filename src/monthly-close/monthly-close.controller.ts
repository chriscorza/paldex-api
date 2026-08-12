import { Controller, Get, Post, Param, Query, Req, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { MonthlyCloseService } from './monthly-close.service';
import { ListMonthlyCloseDto } from './dto/list-monthly-close.dto';

@ApiTags('Monthly Close')
@ApiBearerAuth()
@Controller('monthly-close')
@RequirePermissions('monthly_close:read')
export class MonthlyCloseController {
  constructor(private readonly service: MonthlyCloseService) {}

  @Get()
  findAll(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Query() q: ListMonthlyCloseDto,
  ) {
    return this.service.findAll(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      q,
    );
  }

  @Get(':year/:month')
  findOne(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.findOne(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      parseInt(year),
      parseInt(month),
    );
  }

  @Get(':year/:month/preflight')
  preflight(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.preflight(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      parseInt(year),
      parseInt(month),
    );
  }

  @Get(':year/:month/integrity')
  integrity(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.checkIntegrity(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      parseInt(year),
      parseInt(month),
    );
  }

  @Post(':year/:month/review')
  @RequirePermissions('monthly_close:update')
  review(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.review(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      parseInt(year),
      parseInt(month),
    );
  }

  @Post(':year/:month/close')
  @RequirePermissions('monthly_close:update')
  close(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.service.close(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      parseInt(year),
      parseInt(month),
      u.id,
    );
  }

  @Post(':year/:month/reopen')
  @RequirePermissions('monthly_close:update')
  reopen(
    @CurrentUser() u: { id: number },
    @Req() r: any,
    @Param('year') year: string,
    @Param('month') month: string,
    @Body() body: { reason: string },
  ) {
    return this.service.reopen(
      { userId: u.id, scope: r.permissionScope || 'OWN' },
      parseInt(year),
      parseInt(month),
      body.reason,
      u.id,
    );
  }
}
