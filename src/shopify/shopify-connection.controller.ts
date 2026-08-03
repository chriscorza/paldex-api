import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { ShopifyConnectionService } from './shopify-connection.service';
import { InstallShopifyDto } from './dto/install-shopify.dto';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/auth.decorator';

@ApiTags('shopify')
@ApiBearerAuth('jwt')
@Controller('shopify')
export class ShopifyConnectionController {
  constructor(private readonly shopifyService: ShopifyConnectionService) {}

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
@Controller('shopify/webhooks')
export class ShopifyWebhookController {
  constructor(private readonly shopifyService: ShopifyConnectionService) {}

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
  async orderTransactionsCreate() {
    return { status: 'ok' };
  }

  @Public()
  @Post('orders-create')
  @ApiOperation({ summary: 'Webhook de pedido — llamado por Shopify' })
  async ordersCreate() {
    return { status: 'ok' };
  }

  @Public()
  @Post('orders-updated')
  @ApiOperation({ summary: 'Webhook de pedido editado — llamado por Shopify' })
  async ordersUpdated() {
    return { status: 'ok' };
  }

  @Public()
  @Post('refunds-create')
  @ApiOperation({ summary: 'Webhook de reembolso — llamado por Shopify' })
  async refundsCreate() {
    return { status: 'ok' };
  }
}
