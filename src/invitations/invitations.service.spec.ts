import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../prisma.service';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      invitation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
  });

  describe('create', () => {
    it('should create a new PENDING invitation when the email was never invited', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);
      prisma.invitation.create.mockResolvedValue({
        id: 1,
        email: 'ana@empresa.com',
        status: 'PENDING',
        user_id: null,
      });

      const result = await service.create('ana@empresa.com', 9);

      expect(result.status).toBe('PENDING');
      expect(prisma.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'ana@empresa.com',
            invited_by: 9,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should reject inviting an email with a PENDING invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 1,
        status: 'PENDING',
      });

      await expect(service.create('ana@empresa.com', 9)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it('should reject inviting an email with an ACTIVE invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
      });

      await expect(service.create('ana@empresa.com', 9)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reactivate a REVOKED invitation with a linked user to ACTIVE', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 1,
        status: 'REVOKED',
        user_id: 5,
      });
      prisma.invitation.update.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
        user_id: 5,
      });

      const result = await service.create('ana@empresa.com', 9);

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: 'ACTIVE',
            revoked_at: null,
          }),
        }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('should reactivate a REVOKED invitation without a user to PENDING', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 1,
        status: 'REVOKED',
        user_id: null,
      });
      prisma.invitation.update.mockResolvedValue({
        id: 1,
        status: 'PENDING',
        user_id: null,
      });

      await service.create('ana@empresa.com', 9);

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return every invitation regardless of status', async () => {
      prisma.invitation.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
    });
  });

  describe('revoke', () => {
    it('should mark the invitation as REVOKED', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 1,
        status: 'ACTIVE',
      });
      prisma.invitation.update.mockResolvedValue({
        id: 1,
        status: 'REVOKED',
      });

      const result = await service.revoke(1);

      expect(result.status).toBe('REVOKED');
      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'REVOKED' }),
        }),
      );
    });

    it('should throw NotFoundException for a missing invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.revoke(999)).rejects.toThrow(NotFoundException);
    });
  });
});
