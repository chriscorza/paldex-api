import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma.service';
import { encryptAccessToken, decryptAccessToken } from './crypto';
import { InstallShopifyDto } from './dto/install-shopify.dto';
import { UpdateGatewayAccountsDto } from './dto/update-gateway-accounts.dto';
import { ShopifyBackfillService } from './shopify-backfill.service';

@Injectable()
export class ShopifyConnectionService {
  private usedNonces = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private backfillService: ShopifyBackfillService,
  ) {}

  async install(
    userId: number,
    dto: InstallShopifyDto,
  ): Promise<{ authorize_url: string }> {
    const domain = dto.shop_domain.trim();
    if (!domain.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)) {
      throw new BadRequestException('shop_domain must match *.myshopify.com');
    }

    const account = await this.prisma.account.findFirst({
      where: { id: dto.account_id, user_id: userId },
    });
    if (!account) {
      throw new NotFoundException(
        `Account with id ${dto.account_id} not found`,
      );
    }

    const existing = await this.prisma.shopifyConnection.findUnique({
      where: { shop_domain: domain },
    });
    if (
      existing &&
      existing.status === 'ACTIVE' &&
      existing.user_id !== userId
    ) {
      throw new ConflictException(
        'This shop is already connected by another user',
      );
    }

    const nonce = Math.random().toString(36).substring(2);
    this.usedNonces.add(nonce);

    const state = await this.jwtService.signAsync(
      { user_id: userId, account_id: dto.account_id, nonce },
      { secret: process.env.JWT_SECRET + '-shopify-state', expiresIn: '5m' },
    );

    const apiKey = process.env.SHOPIFY_API_KEY;
    const scopes = process.env.SHOPIFY_SCOPES || 'read_orders,read_inventory';
    const redirectUri =
      process.env.SHOPIFY_CALLBACK_URL ||
      'http://localhost:3000/shopify/oauth/callback';

    const params = new URLSearchParams({
      client_id: apiKey || '',
      scope: scopes,
      redirect_uri: redirectUri,
      state,
    });

    return {
      authorize_url: `https://${domain}/admin/oauth/authorize?${params.toString()}`,
    };
  }

  async handleCallback(
    code: string,
    shop: string,
    state: string,
  ): Promise<{ success: boolean; errorCode?: string }> {
    try {
      let payload: any;
      try {
        payload = this.jwtService.verify(state, {
          secret: process.env.JWT_SECRET + '-shopify-state',
        });
      } catch {
        return { success: false, errorCode: 'invalid_state' };
      }

      if (this.usedNonces.has(payload.nonce)) {
        this.usedNonces.delete(payload.nonce);
      }

      const apiKey = process.env.SHOPIFY_API_KEY;
      const apiSecret = process.env.SHOPIFY_API_SECRET;

      if (!apiKey || !apiSecret) {
        return { success: false, errorCode: 'missing_credentials' };
      }

      const tokenResponse = await fetch(
        `https://${shop}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: apiKey,
            client_secret: apiSecret,
            code,
          }),
        },
      );

      if (!tokenResponse.ok) {
        return { success: false, errorCode: 'token_exchange_failed' };
      }

      const tokenData: any = await tokenResponse.json();

      const shopResponse = await fetch(
        `https://${shop}/admin/api/2026-07/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': tokenData.access_token,
          },
          body: JSON.stringify({
            query: 'query { shop { currencyCode } }',
          }),
        },
      );
      const shopData: any = await shopResponse.json();

      if (shopData?.data?.shop?.currencyCode !== 'MXN') {
        return { success: false, errorCode: 'unsupported_currency' };
      }

      const encrypted = encryptAccessToken(tokenData.access_token);

      await this.prisma.shopifyConnection.upsert({
        where: { shop_domain: shop },
        create: {
          user_id: payload.user_id,
          shop_domain: shop,
          account_id: payload.account_id,
          access_token: encrypted,
          scope: tokenData.scope || '',
          status: 'ACTIVE',
        },
        update: {
          access_token: encrypted,
          scope: tokenData.scope || '',
          status: 'ACTIVE',
          account_id: payload.account_id,
          user_id: payload.user_id,
        },
      });

      this.prisma
        .$executeRawUnsafe(
          `UPDATE shopify_connections SET last_synced_at = NOW() WHERE shop_domain = ?`,
          shop,
        )
        .catch(() => {});

      const callbackUrl =
        process.env.SHOPIFY_CALLBACK_URL ||
        'http://localhost:3000/shopify/oauth/callback';
      const webhookBaseUrl = callbackUrl.replace(
        '/shopify/oauth/callback',
        '',
      );

      const conn = await this.prisma.shopifyConnection.findUnique({
        where: { shop_domain: shop },
        select: { id: true },
      });

      if (conn) {
        this.backfillService
          .registerWebhooksAndBackfill(conn.id, `${webhookBaseUrl}/shopify/webhooks`)
          .catch((err) => {
            console.error('Failed to setup webhooks/backfill:', err);
          });
      }

      return { success: true };
    } catch {
      return { success: false, errorCode: 'unknown' };
    }
  }

  async findConnections(userId: number) {
    return this.prisma.shopifyConnection.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        shop_domain: true,
        account_id: true,
        scope: true,
        status: true,
        installed_at: true,
        last_synced_at: true,
      },
      orderBy: { installed_at: 'desc' },
    });
  }

  async revokeConnection(userId: number, connectionId: number) {
    const conn = await this.prisma.shopifyConnection.findFirst({
      where: { id: connectionId, user_id: userId },
    });
    if (!conn) {
      throw new NotFoundException(
        `Connection with id ${connectionId} not found`,
      );
    }

    try {
      const token = decryptAccessToken(conn.access_token);
      await fetch(`https://${conn.shop_domain}/admin/oauth/access_token`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY }),
      });
    } catch {}

    await this.prisma.shopifyConnection.update({
      where: { id: conn.id },
      data: { status: 'REVOKED', access_token: '' },
    });

    return { id: conn.id, shop_domain: conn.shop_domain, status: 'REVOKED' };
  }

  async handleShopRedact(shopDomain: string) {
    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { shop_domain: shopDomain },
    });
    if (conn) {
      await this.prisma.shopifyConnection.update({
        where: { id: conn.id },
        data: { status: 'REVOKED', access_token: '' },
      });
    }
  }

  async getGatewayAccounts(userId: number, connectionId: number) {
    await this.verifyConnectionOwnership(userId, connectionId);

    const [saved, seenGateways] = await Promise.all([
      this.prisma.shopifyGatewayAccount.findMany({
        where: { shopify_connection_id: connectionId },
        select: { gateway: true, account_id: true },
        orderBy: { gateway: 'asc' },
      }),
      this.prisma.income.groupBy({
        by: ['channel'],
        where: {
          source: 'shopify',
          shopify_order: {
            shopify_connection_id: connectionId,
          },
          channel: { not: null },
        },
      }),
    ]);

    return {
      mappings: saved,
      seen_gateways: seenGateways.map((g) => g.channel).filter(Boolean),
    };
  }

  async updateGatewayAccounts(
    userId: number,
    connectionId: number,
    dto: UpdateGatewayAccountsDto,
  ) {
    const conn = await this.verifyConnectionOwnership(userId, connectionId);

    const gateways = dto.mappings.map((m) => m.gateway);
    const uniqueGateways = new Set(gateways);
    if (uniqueGateways.size !== gateways.length) {
      throw new BadRequestException('Duplicate gateways are not allowed');
    }

    for (const m of dto.mappings) {
      const account = await this.prisma.account.findFirst({
        where: { id: m.account_id, user_id: conn.user_id },
      });
      if (!account) {
        throw new BadRequestException(
          `Account ${m.account_id} does not belong to the connection owner`,
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.shopifyGatewayAccount.deleteMany({
        where: { shopify_connection_id: connectionId },
      }),
      ...dto.mappings.map((m) =>
        this.prisma.shopifyGatewayAccount.create({
          data: {
            shopify_connection_id: connectionId,
            gateway: m.gateway,
            account_id: m.account_id,
          },
        }),
      ),
    ]);

    return this.getGatewayAccounts(userId, connectionId);
  }

  async resolveAccountForGateway(connectionId: number, gateway: string) {
    const mapping = await this.prisma.shopifyGatewayAccount.findUnique({
      where: {
        shopify_connection_id_gateway: {
          shopify_connection_id: connectionId,
          gateway,
        },
      },
      select: { account_id: true },
    });

    if (mapping) return mapping.account_id;

    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { account_id: true },
    });

    return conn?.account_id ?? null;
  }

  async verifyConnectionOwnership(
    userId: number,
    connectionId: number,
  ) {
    const conn = await this.prisma.shopifyConnection.findFirst({
      where: { id: connectionId, user_id: userId },
      select: { id: true, user_id: true },
    });
    if (!conn) {
      throw new NotFoundException(
        `Connection with id ${connectionId} not found`,
      );
    }
    return conn;
  }

  async findActiveConnectionByDomain(shopDomain: string) {
    return this.prisma.shopifyConnection.findUnique({
      where: { shop_domain: shopDomain },
      select: { id: true, status: true },
    });
  }
}
