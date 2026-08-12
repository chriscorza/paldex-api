import { ShopifyGraphQLService } from './shopify-graphql.service';
import { PrismaService } from '../prisma.service';

/*
 * El controlador de webhooks tiene una ruta por topic. Si esta traducción no
 * coincide con esas rutas, Shopify entrega contra un 404 y no se entera nadie:
 * la entrega falla del lado de Shopify, no del nuestro.
 */
describe('ShopifyGraphQLService — URL de cada webhook', () => {
  const service = new ShopifyGraphQLService({} as PrismaService);
  const BASE = 'https://api.corszas.com/shopify/webhooks';

  it.each([
    ['ORDERS_CREATE', `${BASE}/orders-create`],
    ['ORDERS_UPDATED', `${BASE}/orders-updated`],
    ['ORDER_TRANSACTIONS_CREATE', `${BASE}/order-transactions-create`],
    ['REFUNDS_CREATE', `${BASE}/refunds-create`],
  ])('%s apunta a la ruta que existe', (topic, expected) => {
    expect(service.webhookUrlForTopic(BASE, topic)).toBe(expected);
  });

  it('no duplica la barra si la base ya la trae', () => {
    expect(service.webhookUrlForTopic(`${BASE}/`, 'ORDERS_CREATE')).toBe(
      `${BASE}/orders-create`,
    );
  });
});
