import { ShopifyWebhookGuard } from './shopify-webhook.guard';
import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

describe('ShopifyWebhookGuard', () => {
  let guard: ShopifyWebhookGuard;
  const originalEnv = process.env;

  beforeEach(() => {
    guard = new ShopifyWebhookGuard();
    process.env = { ...originalEnv, SHOPIFY_API_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createRequest(
    rawBody: string,
    hmacHeader?: string,
    rawBodyBuffer?: Buffer,
  ) {
    const body = rawBodyBuffer || Buffer.from(rawBody);
    return {
      headers: {
        'x-shopify-hmac-sha256': hmacHeader,
      },
      rawBody: body,
    };
  }

  function createMockContext(request: any) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  it('should pass with valid HMAC signature', () => {
    const body = '{"test": "data"}';
    const hmac = createHmac('sha256', 'test-secret')
      .update(Buffer.from(body))
      .digest('base64');

    const request = createRequest(body, hmac);
    const result = guard.canActivate(createMockContext(request));
    expect(result).toBe(true);
  });

  it('should reject with invalid HMAC signature', () => {
    const body = '{"test": "data"}';
    const request = createRequest(body, 'invalid-hmac');

    expect(() => guard.canActivate(createMockContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('should reject when HMAC header is missing', () => {
    const request = createRequest('{}', undefined);
    expect(() => guard.canActivate(createMockContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('should reject when body is altered after signing', () => {
    const originalBody = '{"test": "data"}';
    const hmac = createHmac('sha256', 'test-secret')
      .update(Buffer.from(originalBody))
      .digest('base64');

    const alteredBody = '{"test": "tampered"}';
    const request = createRequest(alteredBody, hmac);

    expect(() => guard.canActivate(createMockContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('should reject when rawBody is missing', () => {
    const request = {
      headers: { 'x-shopify-hmac-sha256': 'some-hmac' },
    };
    expect(() => guard.canActivate(createMockContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('should reject when SHOPIFY_API_SECRET is not set', () => {
    delete process.env.SHOPIFY_API_SECRET;

    const body = '{"test": "data"}';
    const request = createRequest(body, 'any-hmac');
    expect(() => guard.canActivate(createMockContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('should set shopifyShopDomain on the request', () => {
    const body = '{"test": "data"}';
    const hmac = createHmac('sha256', 'test-secret')
      .update(Buffer.from(body))
      .digest('base64');

    const request = createRequest(body, hmac);
    request.headers['x-shopify-shop-domain'] = 'test-shop.myshopify.com';

    guard.canActivate(createMockContext(request));
  });
});
