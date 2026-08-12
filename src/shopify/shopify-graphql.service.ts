import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { decryptAccessToken } from './crypto';

@Injectable()
export class ShopifyGraphQLService {
  private readonly logger = new Logger(ShopifyGraphQLService.name);
  private readonly API_VERSION = '2026-07';

  constructor(private prisma: PrismaService) {}

  async graphql<T = any>(
    connectionId: number,
    query: string,
    variables?: Record<string, any>,
  ): Promise<T> {
    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { shop_domain: true, access_token: true },
    });

    if (!conn) throw new Error(`Connection ${connectionId} not found`);

    const token = decryptAccessToken(conn.access_token);

    const response = await fetch(
      `https://${conn.shop_domain}/admin/api/${this.API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    const json: any = await response.json();

    if (json.errors) {
      this.logger.error(
        `GraphQL errors for connection ${connectionId}`,
        JSON.stringify(json.errors),
      );
      throw new Error(
        `GraphQL error: ${json.errors[0]?.message || 'Unknown error'}`,
      );
    }

    return json.data as T;
  }

  async registerWebhooks(
    connectionId: number,
    topics: string[],
    callbackUrl: string,
  ): Promise<void> {
    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { shop_domain: true, access_token: true },
    });

    if (!conn) throw new Error(`Connection ${connectionId} not found`);

    const token = decryptAccessToken(conn.access_token);

    for (const topic of topics) {
      try {
        const query = `
          mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }) {
              userErrors { field message }
              webhookSubscription { id }
            }
          }
        `;

        const response = await fetch(
          `https://${conn.shop_domain}/admin/api/${this.API_VERSION}/graphql.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': token,
            },
            body: JSON.stringify({
              query,
              variables: { topic, callbackUrl },
            }),
          },
        );

        const json: any = await response.json();
        const userErrors = json?.data?.webhookSubscriptionCreate?.userErrors;

        if (userErrors?.length > 0) {
          this.logger.warn(
            `Failed to register webhook ${topic} for connection ${connectionId}: ${userErrors[0].message}`,
          );
        } else {
          this.logger.log(
            `Registered webhook ${topic} for connection ${connectionId}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Error registering webhook ${topic} for connection ${connectionId}`,
          err,
        );
      }
    }
  }

  async bulkOperationRunQuery(
    connectionId: number,
    query: string,
  ): Promise<{ bulkOperation: { id: string; status: string } }> {
    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { shop_domain: true, access_token: true },
    });

    if (!conn) throw new Error(`Connection ${connectionId} not found`);

    const token = decryptAccessToken(conn.access_token);

    const mutation = `
      mutation bulkOperationRunQuery($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `;

    const response = await fetch(
      `https://${conn.shop_domain}/admin/api/${this.API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({
          query: mutation,
          variables: { query },
        }),
      },
    );

    const json: any = await response.json();
    const data = json?.data?.bulkOperationRunQuery;

    if (data?.userErrors?.length > 0) {
      throw new Error(`Bulk operation error: ${data.userErrors[0].message}`);
    }

    return data;
  }

  async pollBulkOperation(
    connectionId: number,
    operationId: string,
  ): Promise<{ status: string; url: string | null }> {
    const query = `
      query poll($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            status
            url
            errorCode
          }
        }
      }
    `;

    const data: any = await this.graphql(connectionId, query, {
      id: operationId,
    });

    const node = data?.node;
    if (!node) throw new Error(`Bulk operation ${operationId} not found`);

    return { status: node.status, url: node.url || null };
  }

  async downloadBulkOperationResult(url: string): Promise<string> {
    const response = await fetch(url);
    return response.text();
  }
}
