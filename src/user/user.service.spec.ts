import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

const safeUser = {
  id: 1,
  email: 'test@test.com',
  name: 'Test',
  photo_url: null,
  locale: 'es',
  created_at: new Date(),
};

describe('UserService', () => {
  let service: UserService;
  let prisma: any;
  let permissionsService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      role: {
        findUnique: jest.fn(),
      },
      invitation: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    permissionsService = {
      invalidate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('findMe', () => {
    it('should return safe user profile', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);

      const result = await service.findMe(1);

      expect(result).toEqual(safeUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      const call = prisma.user.findUnique.mock.calls[0][0];
      expect(call.select).toBeDefined();
    });

    it('should throw NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findMe(9999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('should update and return safe user', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.user.update.mockResolvedValue({ ...safeUser, name: 'New' });

      const result = await service.updateMe(1, { name: 'New' });

      expect(result.name).toBe('New');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'New' }),
        }),
      );
    });

    it('should reject email in use by another user', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.user.findFirst.mockResolvedValue({ id: 2 });

      await expect(
        service.updateMe(1, { email: 'other@test.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow updating to own email', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.user.update.mockResolvedValue(safeUser);

      await service.updateMe(1, { email: 'test@test.com' });

      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('should catch P2002 and throw ConflictException', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.user.findFirst.mockResolvedValue(null);
      const p2002Error = Object.assign(new Error(), { code: 'P2002' });
      prisma.user.update.mockRejectedValue(p2002Error);

      await expect(
        service.updateMe(1, { email: 'new@test.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.updateMe(9999, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeMe', () => {
    it('should delete user and return safe profile', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.user.delete.mockResolvedValue(safeUser);

      const result = await service.removeMe(1);

      expect(result).toEqual(safeUser);
    });

    it('should throw NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.removeMe(9999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createUser', () => {
    it('should return safe user without password', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 10,
        status: 'PENDING',
      });
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(safeUser);

      const result = await service.createUser({
        email: 'new@test.com',
        password: 'secret',
      });

      expect(result).toEqual(safeUser);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.any(Object),
        }),
      );
    });

    it('should reject registration without a pending invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(
        service.createUser({ email: 'ghost@test.com', password: 'secret' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should reject registration with a revoked invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 10,
        status: 'REVOKED',
      });

      await expect(
        service.createUser({ email: 'revoked@test.com', password: 'secret' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should activate the invitation and link the new user', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 10,
        status: 'PENDING',
      });
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(safeUser);

      await service.createUser({ email: 'new@test.com', password: 'secret' });

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            status: 'ACTIVE',
            user_id: safeUser.id,
          }),
        }),
      );
    });
  });
});
