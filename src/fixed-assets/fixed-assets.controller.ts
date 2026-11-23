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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { FixedAssetsService } from './fixed-assets.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { DisposeFixedAssetDto } from './dto/dispose-fixed-asset.dto';
import { FilterFixedAssetsDto } from './dto/filter-fixed-assets.dto';
import {
  FixedAssetEntity,
  PaginatedFixedAssetsEntity,
} from './entities/fixed-asset.entity';

const ctxOf = (user: { id: number }, request: any): OwnershipContext => ({
  userId: user.id,
  scope: request.permissionScope || 'OWN',
  ownerUserId: request.booksOwnerId,
});

@ApiTags('fixed-assets')
@ApiBearerAuth('jwt')
@Controller('fixed-assets')
@RequirePermissions('fixed_asset:read')
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar activos fijos con su depreciación a una fecha',
    description:
      'Depreciación en línea recta, desde el mes siguiente a la entrada en uso. ' +
      'Es la de gestión (para el EBITDA), no la fiscal exacta.',
  })
  @ApiOkResponse({ type: PaginatedFixedAssetsEntity })
  findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: FilterFixedAssetsDto,
  ) {
    return this.service.findAll(ctxOf(user, request), query);
  }

  @Get(':id')
  @ApiQuery({ name: 'as_of', required: false })
  @ApiOkResponse({ type: FixedAssetEntity })
  findOne(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('as_of') asOf?: string,
  ) {
    return this.service.findOne(ctxOf(user, request), id, asOf);
  }

  @Post()
  @RequirePermissions('fixed_asset:create')
  @ApiOperation({
    summary: 'Registrar un activo fijo',
    description:
      'Si no se indica la vida útil, se toma la sugerida por la clase (tasas máximas ' +
      'de la LISR). Si se vincula `expense_id`, el gasto debe estar en una categoría ' +
      'CAPEX ("Compra de activo fijo"): si no, 400, para no contar la compra como ' +
      'gasto y como depreciación a la vez.',
  })
  @ApiOkResponse({ type: FixedAssetEntity })
  create(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Body() dto: CreateFixedAssetDto,
  ) {
    return this.service.create(ctxOf(user, request), dto);
  }

  @Patch(':id')
  @RequirePermissions('fixed_asset:update')
  @ApiOperation({
    summary: 'Editar un activo fijo',
    description:
      'Cambia la depreciación de todos sus meses, cerrados incluidos: el cierre ' +
      'mensual lo detecta como desactualizado.',
  })
  @ApiOkResponse({ type: FixedAssetEntity })
  update(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFixedAssetDto,
  ) {
    return this.service.update(ctxOf(user, request), id, dto);
  }

  @Post(':id/dispose')
  @RequirePermissions('fixed_asset:update')
  @ApiOperation({
    summary: 'Dar de baja un activo (venta, robo, desecho)',
    description:
      'Deja de depreciarse desde el mes de la baja. La ganancia o pérdida ' +
      '(lo recibido − valor en libros) aparece en el estado de resultados abajo del EBIT.',
  })
  @ApiOkResponse({ type: FixedAssetEntity })
  dispose(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisposeFixedAssetDto,
  ) {
    return this.service.dispose(ctxOf(user, request), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('fixed_asset:delete')
  remove(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(ctxOf(user, request), id);
  }
}
