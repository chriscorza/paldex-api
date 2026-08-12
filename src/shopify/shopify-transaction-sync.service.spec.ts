import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyTransactionSyncService } from './shopify-transaction-sync.service';

/*
 * Los reportes de P&L suman `net_amount`, nunca `amount`. Un ingreso de Shopify
 * sin esa columna existe en la tabla, se ve en el listado y cuenta cero en todos
 * los reportes — que es exactamente lo que pasó con 2707 ventas importadas.
 */
describe('ShopifyTransactionSyncService — desglose comercial', () => {
  let service: ShopifyTransactionSyncService;
  let prisma: any;
  let connectionService: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyTransactionSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopifyConnectionService, useValue: connectionService },
      ],
    }).compile();

    service = module.get<ShopifyTransactionSyncService>(
      ShopifyTransactionSyncService,
    );
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
