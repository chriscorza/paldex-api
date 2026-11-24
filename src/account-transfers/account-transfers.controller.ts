import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { AccountTransfersService } from './account-transfers.service';
import {
  CreateAccountTransferDto,
  FilterAccountTransfersDto,
  UpdateAccountTransferDto,
} from './dto/account-transfer.dto';
import {
  AccountTransferEntity,
  PaginatedAccountTransfersEntity,
} from './entities/account-transfer.entity';

const ctxOf = (user: { id: number }, request: any): OwnershipContext => ({
  userId: user.id,
  scope: request.permissionScope || 'OWN',
  ownerUserId: request.booksOwnerId,
});

@ApiTags('account-transfers')
@ApiBearerAuth('jwt')
@Controller('account-transfers')
@RequirePermissions('account_transfer:read')
export class AccountTransfersController {
  constructor(private readonly service: AccountTransfersService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar traspasos entre cuentas',
    description:
      'Con `account_id`, los que salen de o llegan a esa cuenta. Fechas en la zona del negocio, último día incluido.',
  })
  @ApiOkResponse({ type: PaginatedAccountTransfersEntity })
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: FilterAccountTransfersDto,
  ) {
    return this.service.findAll(ctxOf(user, request), query);
  }

  @Get(':id')
  @ApiOkResponse({ type: AccountTransferEntity })
  findOne(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(ctxOf(user, request), id);
  }

  @Post()
  @RequirePermissions('account_transfer:create')
  @ApiOperation({
    summary: 'Registrar un traspaso entre cuentas',
    description:
      'No es ingreso ni gasto: sólo mueve el saldo calculado de las dos cuentas. Si hay comisión ' +
      '(`fee_amount` > 0, con `fee_category_id`), se registra como un gasto pagado desde la cuenta origen. ' +
      'Un mes cerrado responde 409.',
  })
  @ApiOkResponse({ type: AccountTransferEntity })
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreateAccountTransferDto,
  ) {
    return this.service.create(ctxOf(user, request), dto);
  }

  @Patch(':id')
  @RequirePermissions('account_transfer:update')
  @ApiOperation({
    summary: 'Editar un traspaso',
    description:
      'Actualiza también el gasto de la comisión; con `fee_amount` = 0 lo borra.',
  })
  @ApiOkResponse({ type: AccountTransferEntity })
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountTransferDto,
  ) {
    return this.service.update(ctxOf(user, request), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('account_transfer:delete')
  @ApiOperation({ summary: 'Borrar un traspaso (y el gasto de su comisión)' })
  remove(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(ctxOf(user, request), id);
  }
}
