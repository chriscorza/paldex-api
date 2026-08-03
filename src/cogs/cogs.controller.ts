import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { CogsService } from './cogs.service';
import { CreateCogsDto, UpdateCogsDto } from './dto/create-cogs.dto';

@ApiTags('COGS')
@ApiBearerAuth()
@Controller()
@RequirePermissions('cogs:read')
export class CogsController {
  constructor(private readonly service: CogsService) {}

  @Get('incomes/:incomeId/cogs')
  findByIncome(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('incomeId', ParseIntPipe) incomeId: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.findByIncome(ctx, incomeId);
  }

  @Post('incomes/:incomeId/cogs')
  @RequirePermissions('cogs:create')
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('incomeId', ParseIntPipe) incomeId: number,
    @Body() dto: CreateCogsDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.create(ctx, incomeId, dto);
  }

  @Patch('cogs/:id')
  @RequirePermissions('cogs:update')
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCogsDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.service.update(ctx, id, dto);
  }

  @Delete('cogs/:id')
  @RequirePermissions('cogs:delete')
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
}
