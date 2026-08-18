import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OwnershipContext } from '../common/ownership';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventorySnapshotsQueryDto } from './dto/inventory-valuation-query.dto';
import {
  InventorySnapshotEntity,
  InventorySnapshotListEntity,
} from './entities/inventory-snapshot.entity';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly snapshots: InventorySnapshotService) {}

  @Post('snapshots')
  @RequirePermissions('inventory:sync')
  @ApiOperation({
    summary: 'Toma una foto de las existencias',
    description:
      'Consulta las existencias en Shopify de cada conexión activa del dueño y ' +
      'guarda una foto fechada, valuando cada renglón con el costo vigente en ' +
      'ese momento. La foto sólo queda disponible para el avalúo si la captura ' +
      'termina completa. Requiere que la conexión tenga el permiso ' +
      '`read_inventory`; si no lo tiene hay que reinstalarla.',
  })
  @ApiOkResponse({ type: [InventorySnapshotEntity] })
  async capture(@CurrentUser() user: { id: number }, @Req() request: any) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    const snapshots = await this.snapshots.captureForOwner(ctx);
    return snapshots.map((snapshot) => new InventorySnapshotEntity(snapshot));
  }

  @Get('snapshots')
  @RequirePermissions('inventory:read')
  @ApiOperation({
    summary: 'Histórico de fotos de inventario',
    description:
      'De la más reciente a la más antigua, con sus totales. Las fotos se ' +
      'conservan: tomar una nueva no pisa la anterior, y por eso se puede ' +
      'saber cuánto valía el inventario al cierre de un mes ya pasado.',
  })
  @ApiOkResponse({ type: InventorySnapshotListEntity })
  list(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: InventorySnapshotsQueryDto,
  ) {
    const ctx: OwnershipContext = {
      userId: user.id,
      scope: request.permissionScope || 'OWN',
    };
    return this.snapshots.listSnapshots(ctx, query);
  }
}
