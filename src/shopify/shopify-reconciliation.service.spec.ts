import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';
import { ShopifyReconciliationService } from './shopify-reconciliation.service';

/*
 * Este servicio nunca había corrido. El endpoint que lo dispara sólo se llamaba
 * a mano, nadie lo llamó, y el día que un cron lo hizo resultó que la consulta
 * pedía `parentId` —un campo que no existe en `OrderTransaction`— y Shopify la
 * rechazaba entera. La red que recoge las ventas que el webhook no entregó
 * llevaba meses caída sin que nada lo dijera.
 */
describe('ShopifyReconciliationService', () => {
  let service: ShopifyReconciliationService;
  let prisma: any;
  let graphql: any;
  let transactionSync: any;

  /*
   * El id va como GID porque es lo que devuelve GraphQL. Con un `'9999'` pelado
   * —como estaba— los tests pasaban mientras producción duplicaba cada venta:
   * el fixture no se parecía a lo que Shopify manda.
   */
  const transaction = (over: Record<string, unknown> = {}) => ({
    id: 'gid://shopify/OrderTransaction/9999',
    kind: 'SALE',
    status: 'SUCCESS',
    amountSet: { shopMoney: { amount: '250.00' } },
    gateway: 'cash',
    processedAt: '2026-08-17T19:40:11Z',
    ...over,
  });

  const page = (transactions: unknown[]) => ({
    orders: {
      edges: [
        {
          node: {
            id: 'gid://shopify/Order/1',
            legacyResourceId: '7904185221367',
            transactions,
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });

  beforeEach(async () => {
    prisma = {
      shopifyConnection: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 1, last_synced_at: null }]),
        findUnique: jest.fn().mockResolvedValue({ last_synced_at: null }),
        update: jest.fn(),
      },
      income: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
    };
    graphql = { graphql: jest.fn().mockResolvedValue(page([transaction()])) };
    transactionSync = { handleTransactionCreate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopifyGraphQLService, useValue: graphql },
        {
          provide: ShopifyTransactionSyncService,
          useValue: transactionSync,
        },
      ],
    }).compile();

    service = module.get<ShopifyReconciliationService>(
      ShopifyReconciliationService,
    );
  });

  /*
   * Lo que hizo caer todo: cualquier campo de más en la consulta la tumba
   * entera, no sólo esa columna. Se comprueba contra lo que el mapeo lee de
   * verdad, para que agregar uno sin usarlo no vuelva a pasar inadvertido.
   */
  it('no pide de la transacción ningún campo que no lea', async () => {
    await service.reconcileAll();

    const query: string = graphql.graphql.mock.calls[0][1];
    const block = /transactions\s*{([\s\S]*?)\n\s*}/.exec(query);
    /* Sólo los nombres de campo: las llaves de `amountSet` no cuentan. */
    const requested = (block?.[1] ?? '')
      .replace(/{[^}]*}/g, '')
      .split(/\s+/)
      .filter((token) => /^[A-Za-z]+$/.test(token));

    expect(requested.sort()).toEqual([
      'amountSet',
      'gateway',
      'id',
      'kind',
      'processedAt',
      'status',
    ]);
  });

  it('crea el ingreso de la transacción que no está registrada', async () => {
    prisma.income.findFirst.mockResolvedValue(null);

    const result = await service.reconcileAll();

    expect(result.discrepancies).toBe(1);
    expect(transactionSync.handleTransactionCreate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: '9999', order_id: '7904185221367' }),
    );
  });

  /*
   * Los dos lados del GID, que es donde estuvo el daño: buscar por la forma
   * equivocada no reconoce ningún cobro ya registrado y duplica cada venta que
   * revisa; guardarla mal deja el duplicado imposible de reconocer la próxima
   * vez.
   */
  it('busca el cobro por el id numérico, no por el GID', async () => {
    await service.reconcileAll();

    expect(prisma.income.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ external_transaction_id: '9999' }),
      }),
    );
  });

  it('no duplica un cobro que ya está registrado', async () => {
    await service.reconcileAll();

    expect(transactionSync.handleTransactionCreate).not.toHaveBeenCalled();
  });

  it('deja avanzar la marca de sincronía cuando no faltaba nada', async () => {
    const result = await service.reconcileAll();

    expect(result.discrepancies).toBe(0);
    expect(prisma.shopifyConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
  });

  /*
   * La marca sólo avanza tras una pasada limpia: moverla con discrepancias
   * pendientes estrecharía la ventana y las dejaría fuera para siempre.
   */
  it('no mueve la marca si quedó una discrepancia', async () => {
    prisma.income.findFirst.mockResolvedValue(null);

    await service.reconcileAll();

    expect(prisma.shopifyConnection.update).not.toHaveBeenCalled();
  });

  it('ignora lo que no es un cobro exitoso', async () => {
    graphql.graphql.mockResolvedValue(
      page([
        transaction({ kind: 'REFUND' }),
        transaction({ status: 'FAILURE' }),
      ]),
    );
    prisma.income.findFirst.mockResolvedValue(null);

    const result = await service.reconcileAll();

    expect(result.discrepancies).toBe(0);
    expect(transactionSync.handleTransactionCreate).not.toHaveBeenCalled();
  });

  it('no tumba las demás tiendas cuando una falla', async () => {
    prisma.shopifyConnection.findMany.mockResolvedValue([
      { id: 1, last_synced_at: null },
      { id: 2, last_synced_at: null },
    ]);
    graphql.graphql
      .mockRejectedValueOnce(new Error('GraphQL error: undefinedField'))
      .mockResolvedValue(page([transaction()]));

    const result = await service.reconcileAll();

    expect(result.connections).toBe(2);
    expect(graphql.graphql).toHaveBeenCalledTimes(2);
  });
});
