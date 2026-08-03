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
import { AccountsService } from './accounts.service';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { FilterAccountsDto } from './dto/filter-accounts.dto';
import { OwnershipContext } from '../common/ownership';

@ApiTags('accounts')
@ApiBearerAuth('jwt')
@Controller('accounts')
@RequirePermissions('account:read')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @RequirePermissions('account:create')
  create(
    @Req() request: any,
    @CurrentUser() user: any,
    @Body() dto: CreateAccountDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.accountsService.create(ctx, dto);
  }

  @Get()
  findAll(
    @Req() request: any,
    @CurrentUser() user: any,
    @Query() filters: FilterAccountsDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.accountsService.findAll(ctx, filters);
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
    return this.accountsService.findOne(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('account:update')
  update(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.accountsService.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('account:delete')
  remove(
    @Req() request: any,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'ANY',
    };
    return this.accountsService.remove(ctx, id);
  }
}
