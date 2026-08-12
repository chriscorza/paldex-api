import { Test, TestingModule } from '@nestjs/testing';
import { ShopifyBackfillService } from './shopify-backfill.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyOrderSyncService } from './shopify-order-sync.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';

/*
 * El JSONL real de una Bulk Operation: el pedido en una línea, cada artículo en
 * la suya con `__parentId`. La línea del pedido no tiene campo `lineItems`.
 */
const ORDER_GID = 'gid://shopify/Order/450789469';

const orderLine = {
  id: ORDER_GID,
  name: '#1001',
  totalPriceSet: { shopMoney: { amount: '598.94' } },
  totalDiscountsSet: { shopMoney: { amount: '10.00' } },
  totalTaxSet: { shopMoney: { amount: '11.94' } },
  transactions: [
    {
      id: 'gid://shopify/OrderTransaction/801038806',
      kind: 'SALE',
      status: 'SUCCESS',
      gateway: 'shopify_payments',
      processedAt: '2026-03-01T10:00:00Z',
      amountSet: { shopMoney: { amount: '598.94' } },
    },
    {
      id: 'gid://shopify/OrderTransaction/801038807',
      kind: 'AUTHORIZATION',
      status: 'SUCCESS',
      gateway: 'shopify_payments',
      processedAt: '2026-03-01T09:59:00Z',
      amountSet: { shopMoney: { amount: '598.94' } },
    },
    {
      id: 'gid://shopify/OrderTransaction/801038808',
      kind: 'SALE',
      status: 'FAILURE',
      gateway: 'cash',
      processedAt: '2026-03-01T10:01:00Z',
      amountSet: { shopMoney: { amount: '50.00' } },
    },
  ],
};

const lineItemLine = {
  id: 'gid://shopify/LineItem/466157049',
  __parentId: ORDER_GID,
  name: 'Camiseta - Roja',
  title: 'Camiseta',
  variantTitle: 'Roja',
  sku: 'CAM-ROJ',
  quantity: 2,
  vendor: 'Corszas',
  product: { id: 'gid://shopify/Product/632910392' },
  variant: { id: 'gid://shopify/ProductVariant/808950810' },
  originalUnitPriceSet: { shopMoney: { amount: '199.00' } },
  discountAllocations: [
    { allocatedAmountSet: { shopMoney: { amount: '10.00' } } },
  ],
  taxLines: [
    { title: 'IVA', rate: 0.16, priceSet: { shopMoney: { amount: '11.94' } } },
  ],
};

const toJsonl = (nodes: any[]) =>
  nodes.map((n) => JSON.stringify(n)).join('\n');

describe('ShopifyBackfillService — procesamiento del JSONL', () => {
  let service: ShopifyBackfillService;
  let graphql: any;
  let orderSync: any;
  let transactionSync: any;

  beforeEach(async () => {
    graphql = {
      bulkOperationRunQuery: jest.fn(),
      pollBulkOperation: jest.fn(),
      downloadBulkOperationResult: jest.fn(),
      registerWebhooks: jest.fn(),
    };
    orderSync = { handleOrderCreate: jest.fn() };
    transactionSync = { handleTransactionCreate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyBackfillService,
        { provide: ShopifyGraphQLService, useValue: graphql },
        { provide: ShopifyOrderSyncService, useValue: orderSync },
        { provide: ShopifyTransactionSyncService, useValue: transactionSync },
      ],
    }).compile();

    service = module.get<ShopifyBackfillService>(ShopifyBackfillService);
  });

  const runWith = async (jsonl: string) => {
    graphql.pollBulkOperation.mockResolvedValue({
      status: 'COMPLETED',
      url: 'https://storage.shopify.com/result.jsonl',
    });
    graphql.downloadBulkOperationResult.mockResolvedValue(jsonl);
    return service.pollAndProcessBackfill(1, 'gid://shopify/BulkOperation/1');
  };

  it('reensambla los artículos que vienen en líneas aparte con __parentId', async () => {
    const result = await runWith(toJsonl([orderLine, lineItemLine]));

    expect(result).toEqual({ processed: 1, errors: 0 });
    expect(orderSync.handleOrderCreate).toHaveBeenCalledTimes(1);

    const [, payload] = orderSync.handleOrderCreate.mock.calls[0];
    expect(payload.line_items).toHaveLength(1);
    expect(payload.line_items[0]).toMatchObject({
      id: '466157049',
      product_id: '632910392',
      variant_id: '808950810',
      sku: 'CAM-ROJ',
      quantity: 2,
    });
  });

  it('no trata las líneas de artículo como pedidos sueltos', async () => {
    await runWith(toJsonl([orderLine, lineItemLine, lineItemLine]));

    expect(orderSync.handleOrderCreate).toHaveBeenCalledTimes(1);
  });

  it('agrupa correctamente aunque el hijo llegue antes que el padre', async () => {
    await runWith(toJsonl([lineItemLine, orderLine]));

    const [, payload] = orderSync.handleOrderCreate.mock.calls[0];
    expect(payload.line_items).toHaveLength(1);
  });

  it('desenvuelve los MoneyBag a strings de importe', async () => {
    await runWith(toJsonl([orderLine, lineItemLine]));

    const [, payload] = orderSync.handleOrderCreate.mock.calls[0];
    expect(payload.total_price).toBe('598.94');
    expect(payload.total_discounts).toBe('10.00');
    expect(payload.total_tax).toBe('11.94');
    expect(payload.line_items[0].price).toBe('199.00');
    expect(payload.line_items[0].discount_allocations).toEqual([
      { amount: '10.00' },
    ]);
    expect(payload.line_items[0].tax_lines).toEqual([
      { title: 'IVA', rate: 0.16, price: '11.94' },
    ]);
  });

  it('extrae el order_number numérico del nombre del admin', async () => {
    await runWith(toJsonl([orderLine, lineItemLine]));

    const [, payload] = orderSync.handleOrderCreate.mock.calls[0];
    expect(payload.order_number).toBe(1001);
    expect(payload.admin_graphql_api_id).toBe(ORDER_GID);
  });

  it('sólo sincroniza transacciones sale/capture con status success', async () => {
    await runWith(toJsonl([orderLine, lineItemLine]));

    expect(transactionSync.handleTransactionCreate).toHaveBeenCalledTimes(1);
    const [, txn] = transactionSync.handleTransactionCreate.mock.calls[0];
    expect(txn.gateway).toBe('shopify_payments');
    expect(txn.amount).toBe('598.94');
  });

  it('usa ids numéricos en las transacciones, como los webhooks', async () => {
    await runWith(toJsonl([orderLine, lineItemLine]));

    const [, txn] = transactionSync.handleTransactionCreate.mock.calls[0];
    /*
     * Income tiene un único [source, external_transaction_id]. Si el backfill
     * guardara el GID, el webhook de esa misma venta crearía un income gemelo.
     */
    expect(txn.id).toBe('801038806');
    expect(txn.order_id).toBe('450789469');
  });

  it('crea el pedido antes que sus transacciones', async () => {
    const calls: string[] = [];
    orderSync.handleOrderCreate.mockImplementation(() => {
      calls.push('order');
    });
    transactionSync.handleTransactionCreate.mockImplementation(() => {
      calls.push('txn');
    });

    await runWith(toJsonl([orderLine, lineItemLine]));

    expect(calls).toEqual(['order', 'txn']);
  });

  it('sigue con el resto de pedidos si uno falla', async () => {
    const second = {
      ...orderLine,
      id: 'gid://shopify/Order/450789470',
      name: '#1002',
    };
    orderSync.handleOrderCreate.mockRejectedValueOnce(new Error('boom'));

    const result = await runWith(toJsonl([orderLine, lineItemLine, second]));

    expect(result).toEqual({ processed: 1, errors: 1 });
  });

  it('descarta líneas corruptas sin abortar el lote', async () => {
    const jsonl = `${JSON.stringify(orderLine)}\n{ esto no es json\n${JSON.stringify(lineItemLine)}`;

    const result = await runWith(jsonl);

    expect(result).toEqual({ processed: 1, errors: 0 });
  });
});

describe('ShopifyBackfillService — ciclo de vida de la operación', () => {
  let service: ShopifyBackfillService;
  let graphql: any;

  beforeEach(async () => {
    graphql = {
      bulkOperationRunQuery: jest.fn().mockResolvedValue({
        bulkOperation: {
          id: 'gid://shopify/BulkOperation/1',
          status: 'CREATED',
        },
      }),
      pollBulkOperation: jest.fn(),
      downloadBulkOperationResult: jest.fn().mockResolvedValue(''),
      registerWebhooks: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyBackfillService,
        { provide: ShopifyGraphQLService, useValue: graphql },
        {
          provide: ShopifyOrderSyncService,
          useValue: { handleOrderCreate: jest.fn() },
        },
        {
          provide: ShopifyTransactionSyncService,
          useValue: { handleTransactionCreate: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ShopifyBackfillService>(ShopifyBackfillService);
    /* Sin esto el bucle de espera tarda 5 s reales por intento. */
    jest
      .spyOn(service as any, 'sleep')
      .mockImplementation(() => Promise.resolve());
  });

  it('espera mientras la operación sigue RUNNING', async () => {
    graphql.pollBulkOperation
      .mockResolvedValueOnce({ status: 'CREATED', url: null })
      .mockResolvedValueOnce({ status: 'RUNNING', url: null })
      .mockResolvedValueOnce({
        status: 'COMPLETED',
        url: 'https://x/result.jsonl',
      });

    await service.pollAndProcessBackfill(1, 'gid://shopify/BulkOperation/1');

    expect(graphql.pollBulkOperation).toHaveBeenCalledTimes(3);
    expect(graphql.downloadBulkOperationResult).toHaveBeenCalledTimes(1);
  });

  it('no descarga nada si la operación falla', async () => {
    graphql.pollBulkOperation.mockResolvedValue({
      status: 'FAILED',
      url: null,
    });

    const result = await service.pollAndProcessBackfill(1, 'op');

    expect(graphql.downloadBulkOperationResult).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('trata COMPLETED sin url como tienda sin pedidos, no como error', async () => {
    graphql.pollBulkOperation.mockResolvedValue({
      status: 'COMPLETED',
      url: null,
    });

    const result = await service.pollAndProcessBackfill(1, 'op');

    expect(graphql.downloadBulkOperationResult).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('el endpoint manual devuelve sin esperar a que termine la operación', async () => {
    let resolvePoll: (v: any) => void = () => {};
    graphql.pollBulkOperation.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    );

    const result = await service.triggerBackfillEndpoint(1);

    expect(result.operationId).toBe('gid://shopify/BulkOperation/1');
    expect(graphql.bulkOperationRunQuery).toHaveBeenCalledTimes(1);

    resolvePoll({ status: 'FAILED', url: null });
  });

  it('traduce «operación ya en curso» a un 409, no a un 500', async () => {
    graphql.bulkOperationRunQuery.mockRejectedValue(
      new Error(
        'Bulk operation error: A bulk query operation for this app and shop ' +
          'is already in progress: gid://shopify/BulkOperation/9.',
      ),
    );

    await expect(service.triggerBackfillEndpoint(1)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('no disfraza el resto de errores de Shopify', async () => {
    graphql.bulkOperationRunQuery.mockRejectedValue(
      new Error('Bulk operation error: Invalid bulk query'),
    );

    await expect(service.triggerBackfillEndpoint(1)).rejects.toThrow(
      /Invalid bulk query/,
    );
  });

  it('el alta de tienda sí procesa el resultado del backfill', async () => {
    graphql.pollBulkOperation.mockResolvedValue({
      status: 'COMPLETED',
      url: 'https://x/result.jsonl',
    });

    await service.startBackfill(1);

    expect(graphql.downloadBulkOperationResult).toHaveBeenCalledTimes(1);
  });
});
