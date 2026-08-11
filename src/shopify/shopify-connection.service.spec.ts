import { Test, TestingModule } from '@nestjs/testing';
import { ShopifyConnectionService } from './shopify-connection.service';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ShopifyBackfillService } from './shopify-backfill.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ShopifyConnectionService — gateway accounts', () => {
  let service: ShopifyConnectionService;
  let prisma: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyConnectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ShopifyBackfillService, useValue: mockBackfillService },
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
      expect(
        prisma.shopifyGatewayAccount.findUnique,
      ).toHaveBeenCalledWith({
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

      const accountId = await service.resolveAccountForGateway(1, 'new_gateway');
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

      await expect(
        service.getGatewayAccounts(10, 999),
      ).rejects.toThrow(NotFoundException);
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
      expect(
        prisma.shopifyGatewayAccount.deleteMany,
      ).toHaveBeenCalledWith({
        where: { shopify_connection_id: 1 },
      });
    });
  });
});
