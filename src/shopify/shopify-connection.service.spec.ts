import { Test, TestingModule } from '@nestjs/testing';
import { ShopifyConnectionService } from './shopify-connection.service';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ShopifyBackfillService } from './shopify-backfill.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ShopifyConnectionService — gateway accounts', () => {
  let service: ShopifyConnectionService;
  let prisma: any;
  let graphql: any;

  beforeEach(async () => {
    prisma = {
      shopifyConnection: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      shopifyGatewayAccount: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      income: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      monthlyClose: {
        findMany: jest.fn(),
      },
      account: {
        findFirst: jest.fn(),
      },
      $executeRawUnsafe: jest.fn(),
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };

    const mockJwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-state-token'),
      verify: jest.fn(),
    };

    const mockBackfillService = {
      registerWebhooksAndBackfill: jest.fn(),
    };

    graphql = { graphql: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyConnectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ShopifyBackfillService, useValue: mockBackfillService },
        { provide: ShopifyGraphQLService, useValue: graphql },
      ],
    }).compile();

    service = module.get<ShopifyConnectionService>(ShopifyConnectionService);
  });

  describe('resolveAccountForGateway', () => {
    it('should return the mapped account when gateway is mapped', async () => {
      prisma.shopifyGatewayAccount.findUnique.mockResolvedValue({
        account_id: 5,
      });

      const accountId = await service.resolveAccountForGateway(1, 'cash');
      expect(accountId).toBe(5);
      expect(prisma.shopifyGatewayAccount.findUnique).toHaveBeenCalledWith({
        where: {
          shopify_connection_id_gateway: {
            shopify_connection_id: 1,
            gateway: 'cash',
          },
        },
        select: { account_id: true },
      });
    });

    it('should fall back to connection default account when gateway is not mapped', async () => {
      prisma.shopifyGatewayAccount.findUnique.mockResolvedValue(null);
      prisma.shopifyConnection.findUnique.mockResolvedValue({
        account_id: 3,
      });

      const accountId = await service.resolveAccountForGateway(
        1,
        'new_gateway',
      );
      expect(accountId).toBe(3);
    });

    it('should return null when connection has no account_id', async () => {
      prisma.shopifyGatewayAccount.findUnique.mockResolvedValue(null);
      prisma.shopifyConnection.findUnique.mockResolvedValue({
        account_id: null,
      });

      const accountId = await service.resolveAccountForGateway(1, 'unknown');
      expect(accountId).toBeNull();
    });
  });

  describe('getGatewayAccounts', () => {
    it('should return mappings and seen gateways', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
      prisma.shopifyGatewayAccount.findMany.mockResolvedValue([
        { gateway: 'cash', account_id: 5 },
        { gateway: 'shopify_payments', account_id: 6 },
      ]);
      prisma.income.groupBy.mockResolvedValue([
        { channel: 'cash' },
        { channel: 'shopify_payments' },
        { channel: 'paypal' },
      ]);

      const result = await service.getGatewayAccounts(10, 1);

      expect(result.mappings).toHaveLength(2);
      expect(result.seen_gateways).toEqual([
        'cash',
        'shopify_payments',
        'paypal',
      ]);
    });

    it('should throw NotFoundException for connection not owned by user', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue(null);

      await expect(service.getGatewayAccounts(10, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateGatewayAccounts', () => {
    it('should validate account ownership', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
      prisma.account.findFirst.mockResolvedValue(null);

      await expect(
        service.updateGatewayAccounts(10, 1, {
          mappings: [{ gateway: 'cash', account_id: 99 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate gateways', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });

      await expect(
        service.updateGatewayAccounts(10, 1, {
          mappings: [
            { gateway: 'cash', account_id: 1 },
            { gateway: 'cash', account_id: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should replace mappings on valid input', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
      prisma.account.findFirst.mockResolvedValue({ id: 1, user_id: 10 });
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
      prisma.shopifyGatewayAccount.deleteMany.mockResolvedValue({});
      prisma.shopifyGatewayAccount.create.mockResolvedValue({});
      prisma.shopifyGatewayAccount.findMany.mockResolvedValue([
        { gateway: 'cash', account_id: 1 },
      ]);
      prisma.income.groupBy.mockResolvedValue([{ channel: 'cash' }]);

      const result = await service.updateGatewayAccounts(10, 1, {
        mappings: [{ gateway: 'cash', account_id: 1 }],
      });

      expect(result.mappings).toHaveLength(1);
      expect(prisma.shopifyGatewayAccount.deleteMany).toHaveBeenCalledWith({
        where: { shopify_connection_id: 1 },
      });
    });
  });

  /*
   * El gateway viaja por tres sitios —se guarda, se resuelve al crear el
   * ingreso y se vuelve a resolver al reasignar— y los tres tienen que
   * normalizarlo igual. Si uno solo divergiera, el mapeo dejaría de casar y los
   * ingresos caerían en la cuenta por defecto sin ningún error visible, que es
   * exactamente lo que pasó con «tarjeta mercadopago».
   */
  describe('normalización del gateway de punta a punta', () => {
    it('guarda el gateway normalizado, con sus espacios interiores', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
      prisma.account.findFirst.mockResolvedValue({ id: 1, user_id: 10 });
      prisma.shopifyGatewayAccount.findMany.mockResolvedValue([]);
      prisma.income.groupBy.mockResolvedValue([]);

      await service.updateGatewayAccounts(10, 1, {
        mappings: [{ gateway: '  Tarjeta MercadoPago ', account_id: 1 }],
      });

      expect(prisma.shopifyGatewayAccount.create).toHaveBeenCalledWith({
        data: {
          shopify_connection_id: 1,
          gateway: 'tarjeta mercadopago',
          account_id: 1,
        },
      });
    });

    it('resuelve la cuenta aunque Shopify mande el gateway con mayúsculas', async () => {
      prisma.shopifyGatewayAccount.findUnique.mockResolvedValue({
        account_id: 5,
      });

      await service.resolveAccountForGateway(1, 'Tarjeta MercadoPago');

      expect(prisma.shopifyGatewayAccount.findUnique).toHaveBeenCalledWith({
        where: {
          shopify_connection_id_gateway: {
            shopify_connection_id: 1,
            gateway: 'tarjeta mercadopago',
          },
        },
        select: { account_id: true },
      });
    });

    it('rechaza como duplicados dos gateways que sólo difieren en caja', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });

      await expect(
        service.updateGatewayAccounts(10, 1, {
          mappings: [
            { gateway: 'Tarjeta MercadoPago', account_id: 1 },
            { gateway: 'tarjeta mercadopago', account_id: 2 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reasigna casando el canal del ingreso con el mapeo normalizado', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
      prisma.shopifyConnection.findUnique.mockResolvedValue({ account_id: 99 });
      prisma.shopifyGatewayAccount.findMany.mockResolvedValue([
        { gateway: 'tarjeta mercadopago', account_id: 7 },
      ]);
      prisma.income.findMany.mockResolvedValue([
        {
          id: 1,
          channel: 'Tarjeta MercadoPago',
          account_id: 99,
          date: new Date('2026-03-01'),
        },
      ]);
      prisma.monthlyClose.findMany.mockResolvedValue([]);
      prisma.income.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result.updated).toBe(1);
      expect(prisma.income.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { account_id: 7 },
      });
    });
  });

  describe('reapplyGatewayMapping', () => {
    const setup = (opts: {
      defaultAccount?: number;
      mappings?: { gateway: string; account_id: number }[];
      incomes?: {
        id: number;
        channel: string | null;
        account_id: number;
        date: Date;
      }[];
      closed?: { year: number; month: number }[];
    }) => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
      prisma.shopifyConnection.findUnique.mockResolvedValue({
        account_id: opts.defaultAccount ?? 99,
      });
      prisma.shopifyGatewayAccount.findMany.mockResolvedValue(
        opts.mappings ?? [],
      );
      prisma.income.findMany.mockResolvedValue(opts.incomes ?? []);
      prisma.monthlyClose.findMany.mockResolvedValue(opts.closed ?? []);
      prisma.income.updateMany.mockResolvedValue({ count: 0 });
    };

    it('mueve los ingresos a la cuenta que dice el mapeo', async () => {
      setup({
        mappings: [{ gateway: 'cash', account_id: 7 }],
        incomes: [
          {
            id: 1,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-03-01'),
          },
          {
            id: 2,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-03-02'),
          },
        ],
      });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result.updated).toBe(2);
      expect(prisma.income.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { account_id: 7 },
      });
    });

    /*
     * Un gateway sin mapeo debe acabar en la cuenta por defecto, que es
     * exactamente lo que hace resolveAccountForGateway al crear el ingreso.
     * Si esto divergiera, reaplicar dejaría los datos en un estado que la
     * sincronización nunca habría producido.
     */
    it('devuelve a la cuenta por defecto los gateways sin mapeo', async () => {
      setup({
        defaultAccount: 99,
        mappings: [{ gateway: 'cash', account_id: 7 }],
        incomes: [
          {
            id: 3,
            channel: 'paypal',
            account_id: 7,
            date: new Date('2026-03-01'),
          },
        ],
      });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result.updated).toBe(1);
      expect(prisma.income.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [3] } },
        data: { account_id: 99 },
      });
    });

    it('no toca los ingresos que ya están en su cuenta', async () => {
      setup({
        mappings: [{ gateway: 'cash', account_id: 7 }],
        incomes: [
          {
            id: 4,
            channel: 'cash',
            account_id: 7,
            date: new Date('2026-03-01'),
          },
        ],
      });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result).toMatchObject({ updated: 0, unchanged: 1 });
      expect(prisma.income.updateMany).not.toHaveBeenCalled();
    });

    it('respeta los meses cerrados y los cuenta aparte', async () => {
      setup({
        mappings: [{ gateway: 'cash', account_id: 7 }],
        incomes: [
          {
            id: 5,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-01-15'),
          },
          {
            id: 6,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-03-15'),
          },
        ],
        closed: [{ year: 2026, month: 1 }],
      });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result).toMatchObject({ updated: 1, skipped_closed_month: 1 });
      expect(prisma.income.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [6] } },
        data: { account_id: 7 },
      });
    });

    it('con dry_run informa lo mismo pero no escribe nada', async () => {
      setup({
        mappings: [{ gateway: 'cash', account_id: 7 }],
        incomes: [
          {
            id: 7,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-03-01'),
          },
        ],
      });

      const result = await service.reapplyGatewayMapping(10, 1, true);

      expect(result).toMatchObject({ dry_run: true, updated: 1 });
      expect(prisma.income.updateMany).not.toHaveBeenCalled();
    });

    it('desglosa por gateway, del que más mueve al que menos', async () => {
      setup({
        mappings: [
          { gateway: 'cash', account_id: 7 },
          { gateway: 'paypal', account_id: 8 },
        ],
        incomes: [
          {
            id: 8,
            channel: 'paypal',
            account_id: 99,
            date: new Date('2026-03-01'),
          },
          {
            id: 9,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-03-01'),
          },
          {
            id: 10,
            channel: 'cash',
            account_id: 99,
            date: new Date('2026-03-01'),
          },
        ],
      });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result.by_gateway).toEqual([
        { gateway: 'cash', account_id: 7, updated: 2 },
        { gateway: 'paypal', account_id: 8, updated: 1 },
      ]);
    });

    it('trocea las actualizaciones en lotes de 500', async () => {
      const incomes = Array.from({ length: 1200 }, (_, i) => ({
        id: i + 1,
        channel: 'cash',
        account_id: 99,
        date: new Date('2026-03-01'),
      }));
      setup({ mappings: [{ gateway: 'cash', account_id: 7 }], incomes });

      const result = await service.reapplyGatewayMapping(10, 1);

      expect(result.updated).toBe(1200);
      expect(prisma.income.updateMany).toHaveBeenCalledTimes(3);
      const sizes = prisma.income.updateMany.mock.calls.map(
        (c: any[]) => c[0].where.id.in.length,
      );
      expect(sizes).toEqual([500, 500, 200]);
    });

    it('no reasigna nada de una conexión que no es del usuario', async () => {
      setup({});
      prisma.shopifyConnection.findFirst.mockResolvedValue(null);

      await expect(service.reapplyGatewayMapping(99, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.income.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('discoverGateways', () => {
    const ordersWith = (transactions: any[][]) => ({
      orders: {
        edges: transactions.map((t) => ({ node: { transactions: t } })),
      },
    });

    beforeEach(() => {
      prisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 1,
        user_id: 10,
      });
    });

    it('devuelve los gateways distintos con su etiqueta legible', async () => {
      graphql.graphql.mockResolvedValue(
        ordersWith([
          [
            {
              kind: 'SALE',
              status: 'SUCCESS',
              gateway: 'cash',
              formattedGateway: 'Efectivo',
            },
          ],
        ]),
      );

      const result = await service.discoverGateways(10, 1);

      expect(result.gateways).toEqual([
        { gateway: 'cash', label: 'Efectivo', count: 1 },
      ]);
      expect(result.orders_sampled).toBe(1);
    });

    it('ordena por frecuencia, del más usado al menos', async () => {
      graphql.graphql.mockResolvedValue(
        ordersWith([
          [{ kind: 'SALE', status: 'SUCCESS', gateway: 'cash' }],
          [{ kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments' }],
          [{ kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments' }],
        ]),
      );

      const result = await service.discoverGateways(10, 1);

      expect(result.gateways.map((g) => g.gateway)).toEqual([
        'shopify_payments',
        'cash',
      ]);
      expect(result.gateways[0].count).toBe(2);
    });

    /*
     * La lista debe contener exactamente los gateways que van a generar
     * ingresos: sugerir uno que la sincronización descarta sería mandar al
     * usuario a mapear algo que nunca se va a usar.
     */
    it('descarta las transacciones que la sincronización no convierte en ingreso', async () => {
      graphql.graphql.mockResolvedValue(
        ordersWith([
          [
            { kind: 'AUTHORIZATION', status: 'SUCCESS', gateway: 'autorizado' },
            { kind: 'SALE', status: 'FAILURE', gateway: 'fallido' },
            { kind: 'REFUND', status: 'SUCCESS', gateway: 'devuelto' },
            { kind: 'CAPTURE', status: 'SUCCESS', gateway: 'valido' },
          ],
        ]),
      );

      const result = await service.discoverGateways(10, 1);

      expect(result.gateways.map((g) => g.gateway)).toEqual(['valido']);
    });

    it('cae al nombre técnico si Shopify no da etiqueta legible', async () => {
      graphql.graphql.mockResolvedValue(
        ordersWith([[{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual' }]]),
      );

      const result = await service.discoverGateways(10, 1);

      expect(result.gateways[0].label).toBe('manual');
    });

    it('devuelve una lista vacía si la tienda no tiene pedidos', async () => {
      graphql.graphql.mockResolvedValue(ordersWith([]));

      const result = await service.discoverGateways(10, 1);

      expect(result.gateways).toEqual([]);
      expect(result.orders_sampled).toBe(0);
    });

    it('no consulta Shopify si la conexión no es del usuario', async () => {
      prisma.shopifyConnection.findFirst.mockResolvedValue(null);

      await expect(service.discoverGateways(99, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(graphql.graphql).not.toHaveBeenCalled();
    });
  });
});
