import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';
import { ShopifyBackfillService } from './shopify-backfill.service';
import { ShopifyReconciliationService } from './shopify-reconciliation.service';
import { InstallShopifyDto } from './dto/install-shopify.dto';
import { UpdateGatewayAccountsDto } from './dto/update-gateway-accounts.dto';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/auth.decorator';
import { ShopifyWebhookGuard } from './shopify-webhook.guard';

@ApiTags('shopify')
@ApiBearerAuth('jwt')
@Controller('shopify')
export class ShopifyConnectionController {
  constructor(
    private readonly shopifyService: ShopifyConnectionService,
    private readonly backfillService: ShopifyBackfillService,
    private readonly reconciliationService: ShopifyReconciliationService,
  ) {}
  @Post('connections/install')
  @RequirePermissions('shopify_connection:create')
  @ApiOperation({
    summary: 'Paso 1: obtener la URL de autorización de Shopify',
    description:
      'Llamar con fetch normal (JWT en Authorization). Devuelve `authorize_url` — el frontend debe hacer una navegación de página completa ' +
      '(`window.location.href = authorize_url`, NO fetch/XHR) a esa URL para que el usuario apruebe el acceso dentro de Shopify. ' +
      'Shopify redirige después directamente a `GET /shopify/oauth/callback` en esta API, no de vuelta al frontend.',
  })
  @ApiOkResponse({
    description: 'URL lista para redirigir el navegador',
    schema: {
      example: {
        authorize_url:
          'https://mitienda.myshopify.com/admin/oauth/authorize?...',
      },
    },
  })
  async install(
    @CurrentUser() user: { id: number; email: string },
    @Body() dto: InstallShopifyDto,
  ) {
    return this.shopifyService.install(user.id, dto);
  }

  @Get('connections')
  @RequirePermissions('shopify_connection:read')
  @ApiOperation({
    summary: 'Listar las tiendas Shopify conectadas por el usuario',
    description: 'Nunca incluye el access_token, ni cifrado ni en claro.',
  })
  findConnections(@CurrentUser() user: { id: number; email: string }) {
    return this.shopifyService.findConnections(user.id);
  }

  @Delete('connections/:id')
  @RequirePermissions('shopify_connection:delete')
  @ApiOperation({
    summary: 'Desconectar una tienda',
    description:
      'Marca la conexión como REVOKED. Los Income y ShopifyOrder ya generados por esa tienda NO se borran.',
  })
  revokeConnection(
    @CurrentUser() user: { id: number; email: string },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shopifyService.revokeConnection(user.id, id);
  }

  @Get('connections/:id/gateway-accounts')
  @RequirePermissions('shopify_connection:read')
  @ApiOperation({
    summary: 'Obtener el mapeo gateway → cuenta de una conexión',
    description:
      'Devuelve los mapeos guardados y los gateways vistos en transacciones sincronizadas, ' +
      'para que el usuario sepa qué gateways existen sin tener que adivinarlos.',
  })
  getGatewayAccounts(
    @CurrentUser() user: { id: number; email: string },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shopifyService.getGatewayAccounts(user.id, id);
  }

  @Get('connections/:id/available-gateways')
  @RequirePermissions('shopify_connection:read')
  @ApiOperation({
    summary: 'Descubrir los gateways que usa la tienda',
    description:
      'Consulta los últimos 100 pedidos en Shopify y devuelve los gateways distintos ' +
      'con los que se ha cobrado, ordenados por frecuencia. Sirve para configurar el ' +
      'mapeo antes de importar nada: los gateways vistos en ingresos ya sincronizados ' +
      '(los que devuelve GET gateway-accounts) están vacíos hasta la primera importación.',
  })
  discoverGateways(
    @CurrentUser() user: { id: number; email: string },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.shopifyService.discoverGateways(user.id, id);
  }

  @Put('connections/:id/gateway-accounts')
  @RequirePermissions('shopify_connection:update')
  @ApiOperation({
    summary: 'Configurar el mapeo gateway → cuenta de una conexión',
    description:
      'Recibe el mapeo completo como array de { gateway, account_id }. ' +
      'Reemplaza todo el mapeo existente. Cada cuenta debe pertenecer al dueño de la conexión. ' +
      'Los gateways no pueden repetirse. Cambiar un mapeo no reasigna incomes ya creados.',
  })
  updateGatewayAccounts(
    @CurrentUser() user: { id: number; email: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGatewayAccountsDto,
  ) {
    return this.shopifyService.updateGatewayAccounts(user.id, id, dto);
  }

  @Post('connections/:id/backfill')
  @RequirePermissions('shopify_connection:update')
  @ApiOperation({
    summary: 'Lanzar backfill manual de pedidos históricos',
    description:
      'Dispara una Bulk Operation de Shopify para importar el histórico de pedidos. ' +
      'Idempotente: no duplica transacciones ya sincronizadas. Útil después de obtener nuevos scopes.',
  })
  async triggerBackfill(
    @CurrentUser() user: { id: number; email: string },
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.shopifyService.verifyConnectionOwnership(user.id, id);
    return this.backfillService.triggerBackfillEndpoint(id);
  }

  @Post('reconcile')
  @RequirePermissions('shopify_connection:update')
  @ApiOperation({
    summary: 'Reconciliar transacciones de todas las tiendas activas',
    description:
      'Compara las transacciones recientes de Shopify contra los incomes registrados y crea los que falten. ' +
      'Idempotente. Actualiza last_synced_at al completar exitosamente.',
  })
  reconcileAll() {
    return this.reconciliationService.reconcileAll();
  }

  @Public()
  @Get('oauth/callback')
  @ApiOperation({
    summary:
      'Paso 2: destino del redirect de Shopify (NO llamar desde el frontend)',
    description:
      'El frontend nunca invoca esto directamente — Shopify redirige aquí solo después de que el usuario aprueba el acceso en el paso 1. ' +
      'Al terminar, esta ruta redirige el navegador de vuelta a `SHOPIFY_FRONTEND_URL` (variable de entorno del backend) con uno de estos resultados:\n\n' +
      '- Éxito: `?shopify=success&shop=<dominio-de-la-tienda>`\n' +
      '- Error: `?shopify=error&reason=<código>`, donde `reason` es uno de: ' +
      '`invalid_state`, `missing_credentials`, `token_exchange_failed`, `unsupported_currency`, `unknown`.\n\n' +
      'El frontend debe tener una ruta que lea estos query params al cargar y muestre éxito o el error correspondiente. ' +
      '`unsupported_currency` significa que la tienda no factura en MXN, el único caso soportado hoy.',
  })
  async oauthCallback(
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.shopifyService.handleCallback(code, shop, state);
    const frontendUrl =
      process.env.SHOPIFY_FRONTEND_URL || 'http://localhost:3002';
    if (result.success) {
      res.redirect(
        `${frontendUrl}?shopify=success&shop=${encodeURIComponent(shop)}`,
      );
    } else {
      res.redirect(
        `${frontendUrl}?shopify=error&reason=${encodeURIComponent(result.errorCode || 'unknown')}`,
      );
    }
  }
}

@ApiTags('shopify-webhooks (Shopify → paldex, no llamar desde el frontend)')
@UseGuards(ShopifyWebhookGuard)
@Controller('shopify/webhooks')
export class ShopifyWebhookController {
  private readonly logger = new Logger(ShopifyWebhookController.name);

  constructor(
    private readonly shopifyService: ShopifyConnectionService,
    private readonly orderSync: ShopifyOrderSyncService,
    private readonly transactionSync: ShopifyTransactionSyncService,
  ) {}

  @Public()
  @Post('customers-data-request')
  @ApiOperation({ summary: 'Webhook de cumplimiento — llamado por Shopify' })
  async customersDataRequest() {
    return { status: 'ok' };
  }

  @Public()
  @Post('customers-redact')
  @ApiOperation({ summary: 'Webhook de cumplimiento — llamado por Shopify' })
  async customersRedact() {
    return { status: 'ok' };
  }

  @Public()
  @Post('shop-redact')
  @ApiOperation({ summary: 'Webhook de cumplimiento — llamado por Shopify' })
  async shopRedact(@Body() body: any) {
    const domain = body?.shop_domain || body?.myshopify_domain;
    if (domain) {
      await this.shopifyService.handleShopRedact(domain);
    }
    return { status: 'ok' };
  }

  @Public()
  @Post('order-transactions-create')
  @ApiOperation({ summary: 'Webhook de venta — llamado por Shopify' })
  async orderTransactionsCreate(@Req() req: any, @Body() body: any) {
    try {
      const connId = await this.resolveConnectionId(req);
      if (connId) {
        await this.transactionSync.handleTransactionCreate(connId, body);
      }
    } catch (err: any) {
      this.logger.error('Error processing order-transactions-create', err);
    }
    return { status: 'ok' };
  }

  @Public()
  @Post('orders-create')
  @ApiOperation({ summary: 'Webhook de pedido — llamado por Shopify' })
  async ordersCreate(@Req() req: any, @Body() body: any) {
    try {
      const connId = await this.resolveConnectionId(req);
      if (connId) {
        await this.orderSync.handleOrderCreate(connId, body);
      }
    } catch (err: any) {
      this.logger.error('Error processing orders-create', err);
    }
    return { status: 'ok' };
  }

  @Public()
  @Post('orders-updated')
  @ApiOperation({ summary: 'Webhook de pedido editado — llamado por Shopify' })
  async ordersUpdated(@Req() req: any, @Body() body: any) {
    try {
      const connId = await this.resolveConnectionId(req);
      if (connId) {
        await this.orderSync.handleOrderUpdate(connId, body);
      }
    } catch (err: any) {
      this.logger.error('Error processing orders-updated', err);
    }
    return { status: 'ok' };
  }

  @Public()
  @Post('refunds-create')
  @ApiOperation({ summary: 'Webhook de reembolso — llamado por Shopify' })
  async refundsCreate(@Req() req: any, @Body() body: any) {
    try {
      const connId = await this.resolveConnectionId(req);
      if (connId) {
        await this.transactionSync.handleRefund(connId, body);
      }
    } catch (err: any) {
      this.logger.error('Error processing refunds-create', err);
    }
    return { status: 'ok' };
  }

  private async resolveConnectionId(req: any): Promise<number | null> {
    const domain = req.shopifyShopDomain;
    if (!domain) {
      this.logger.warn('No shop domain in webhook request');
      return null;
    }

    const conn = await this.shopifyService.findActiveConnectionByDomain(domain);

    if (!conn || conn.status !== 'ACTIVE') {
      this.logger.warn(`No active connection for domain ${domain}`);
      return null;
    }

    return conn.id;
  }
}
