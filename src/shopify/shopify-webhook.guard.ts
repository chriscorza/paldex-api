import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class ShopifyWebhookGuard implements CanActivate {
  private readonly logger = new Logger(ShopifyWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const hmacHeader = request.headers['x-shopify-hmac-sha256'];
    if (!hmacHeader) {
      this.logger.warn('Missing X-Shopify-Hmac-Sha256 header');
      throw new UnauthorizedException('Missing HMAC signature');
    }

    const rawBody = request.rawBody;
    if (!rawBody || !(rawBody instanceof Buffer)) {
      this.logger.warn('Missing raw body — ensure rawBody: true in main.ts');
      throw new UnauthorizedException('Missing raw body');
    }

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      this.logger.error('SHOPIFY_API_SECRET is not set');
      throw new UnauthorizedException('HMAC verification unavailable');
    }

    const computed = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const expected = Buffer.from(hmacHeader as string);
    const actual = Buffer.from(computed);

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      this.logger.warn('HMAC verification failed');
      throw new UnauthorizedException('HMAC verification failed');
    }

    request.shopifyShopDomain = request.headers['x-shopify-shop-domain'] || null;
    return true;
  }
}
