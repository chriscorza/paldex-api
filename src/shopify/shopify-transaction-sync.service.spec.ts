import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';
import { LineItemProjectionService } from './line-item-projection.service';

/*
 * Los reportes de P&L suman `net_amount`, nunca `amount`. Un ingreso de Shopify
 * sin esa columna existe en la tabla, se ve en el listado y cuenta cero en todos
 * los reportes — que es exactamente lo que pasó con 2707 ventas importadas.
 */
describe('ShopifyTransactionSyncService — desglose comercial', () => {
  let service: ShopifyTransactionSyncService;
  let prisma: any;
  let connectionService: any;
  let projection: any;

  const transaction = {
    id: '801038806',
    order_id: '450789469',
    kind: 'sale',
    status: 'success',
    gateway: 'cash',
    amount: '598.94',
    processed_at: '2026-03-01T10:00:00Z',
  };

  beforeEach(async () => {
    prisma = {
      income: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
      },
      shopifyConnection: {
        findUnique: jest.fn().mockResolvedValue({ user_id: 10 }),
      },
      shopifyOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    connectionService = {
      resolveAccountForGateway: jest.fn().mockResolvedValue(7),
    };
    projection = { propagateToIncomes: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyTransactionSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopifyConnectionService, useValue: connectionService },
        { provide: LineItemProjectionService, useValue: projection },
      ],
    }).compile();

    service = module.get<ShopifyTransactionSyncService>(
      ShopifyTransactionSyncService,
    );
  });

  /*
   * El pedido se proyecta antes de que exista la transacción, así que en ese
   * momento no hay income al que colgarle el costo. Si nadie vuelve a repartirlo
   * al crear el income, la venta se queda sin COGS para siempre.
   */
  it('reparte el costo del pedido en cuanto el ingreso existe', async () => {
    await service.handleTransactionCreate(1, transaction);

    expect(projection.propagateToIncomes).toHaveBeenCalledWith(3);
  });

  it('rellena neto y bruto al crear el ingreso', async () => {
    await service.handleTransactionCreate(1, transaction);

    expect(prisma.income.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.income.create.mock.calls[0][0];
    expect(data.amount).toBe(598.94);
    expect(data.net_amount).toBe(598.94);
    expect(data.gross_amount).toBe(598.94);
  });

  it('baja también el neto cuando un reembolso reduce el ingreso', async () => {
    prisma.income.findFirst.mockResolvedValue({
      id: 42,
      amount: 598.94,
      shopify_order_id: null,
    });

    await service.handleRefund(1, {
      transactions: [
        { kind: 'refund', parent_id: '801038806', amount: '100.00' },
      ],
    });

    const { data } = prisma.income.update.mock.calls[0][0];
    /* Decimal, no number: la resta de dinero en punto flotante daría
       498.94000000000005. */
    expect(data.amount.toString()).toBe('498.94');
    expect(data.gross_amount.toString()).toBe('498.94');
    expect(data.net_amount.toString()).toBe('498.94');
  });

  it('borra el ingreso cuando el reembolso es total', async () => {
    prisma.income.findFirst.mockResolvedValue({
      id: 42,
      amount: 100,
      shopify_order_id: null,
    });

    await service.handleRefund(1, {
      transactions: [
        { kind: 'refund', parent_id: '801038806', amount: '100.00' },
      ],
    });

    expect(prisma.income.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(prisma.income.update).not.toHaveBeenCalled();
  });
});

/*
 * Reimportar antes no tocaba los ingresos ya creados: se salía por el duplicado
 * sin más. Cualquier corrección de importes —el neto, o el descuento de un
 * reembolso histórico— se quedaba fuera del histórico ya cargado.
 */
describe('ShopifyTransactionSyncService — reimportación', () => {
  let service: ShopifyTransactionSyncService;
  let prisma: any;
  let projection: any;

  const transaction = {
    id: '801038806',
    order_id: '450789469',
    kind: 'sale',
    status: 'success',
    gateway: 'cash',
    amount: '500.00',
    processed_at: '2026-03-01T10:00:00Z',
  };

  beforeEach(async () => {
    prisma = {
      income: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        updateMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
      },
      shopifyConnection: {
        findUnique: jest.fn().mockResolvedValue({ user_id: 10 }),
      },
      shopifyOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    projection = { propagateToIncomes: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyTransactionSyncService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ShopifyConnectionService,
          useValue: {
            resolveAccountForGateway: jest.fn().mockResolvedValue(7),
          },
        },
        { provide: LineItemProjectionService, useValue: projection },
      ],
    }).compile();

    service = module.get<ShopifyTransactionSyncService>(
      ShopifyTransactionSyncService,
    );
  });

  it('refresca los importes del ingreso que ya existía', async () => {
    await service.handleTransactionCreate(1, transaction);

    const { where, data } = prisma.income.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      source: 'shopify',
      external_transaction_id: '801038806',
    });
    expect(data.amount).toBe(500);
    expect(data.net_amount).toBe(500);
    expect(data.gross_amount).toBe(500);
  });

  /* El mapeo de gateways puede haberse reasignado a mano; no se pisa. */
  it('no toca la cuenta del ingreso al refrescarlo', async () => {
    await service.handleTransactionCreate(1, transaction);

    const { data } = prisma.income.updateMany.mock.calls[0][0];
    expect(data.account_id).toBeUndefined();
  });

  it('reparte el costo también cuando el ingreso ya existía', async () => {
    await service.handleTransactionCreate(1, transaction);

    expect(projection.propagateToIncomes).toHaveBeenCalledWith(3);
  });
});

/*
 * Una venta reembolsada al 100 % antes de la primera importación dejó su
 * ingreso por el total: el reembolso sólo llegaba por webhook y ese ya había
 * pasado. Reimportar tiene que limpiarlo.
 */
describe('ShopifyTransactionSyncService — venta devuelta entera', () => {
  let service: ShopifyTransactionSyncService;
  let prisma: any;
  let projection: any;

  const refundedToZero = {
    id: '801038806',
    order_id: '450789469',
    kind: 'sale',
    status: 'success',
    gateway: 'cash',
    amount: '0.00',
    processed_at: '2026-03-01T10:00:00Z',
  };

  const build = async (existingIncome: any) => {
    prisma = {
      income: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(existingIncome),
      },
      shopifyConnection: { findUnique: jest.fn() },
      shopifyOrder: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    projection = { propagateToIncomes: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyTransactionSyncService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ShopifyConnectionService,
          useValue: { resolveAccountForGateway: jest.fn() },
        },
        { provide: LineItemProjectionService, useValue: projection },
      ],
    }).compile();

    return module.get<ShopifyTransactionSyncService>(
      ShopifyTransactionSyncService,
    );
  };

  it('borra el ingreso que había quedado por el importe completo', async () => {
    service = await build({ id: 42, shopify_order_id: 3 });

    await service.handleTransactionCreate(1, refundedToZero);

    expect(prisma.income.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(prisma.income.create).not.toHaveBeenCalled();
  });

  it('reparte de nuevo el costo entre los ingresos que le queden al pedido', async () => {
    service = await build({ id: 42, shopify_order_id: 3 });

    await service.handleTransactionCreate(1, refundedToZero);

    expect(projection.propagateToIncomes).toHaveBeenCalledWith(3);
  });

  it('no crea nada si nunca hubo ingreso para esa transacción', async () => {
    service = await build(null);

    await service.handleTransactionCreate(1, refundedToZero);

    expect(prisma.income.delete).not.toHaveBeenCalled();
    expect(prisma.income.create).not.toHaveBeenCalled();
  });
});
