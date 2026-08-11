import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;

  beforeEach(async () => {
    mockVerifyIdToken.mockReset();
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('token') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should sign in with correct credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'test@test.com',
      password: 'secret',
    });
    prisma.invitation.findUnique.mockResolvedValue({
      id: 10,
      status: 'ACTIVE',
    });

    const result = await service.signIn('test@test.com', 'secret');

    expect(result).toEqual({ access_token: 'token' });
    expect(result).not.toHaveProperty('password');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, email: true, password: true },
      }),
    );
  });

  it('should reject wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'test@test.com',
      password: 'secret',
    });

    await expect(service.signIn('test@test.com', 'wrong')).rejects.toThrow();
  });

  it('should reject login when the invitation was revoked', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'test@test.com',
      password: 'secret',
    });
    prisma.invitation.findUnique.mockResolvedValue({
      id: 10,
      status: 'REVOKED',
    });

    await expect(service.signIn('test@test.com', 'secret')).rejects.toThrow();
  });

  it('should reject login when there is no invitation row at all', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'test@test.com',
      password: 'secret',
    });
    prisma.invitation.findUnique.mockResolvedValue(null);

    await expect(service.signIn('test@test.com', 'secret')).rejects.toThrow();
  });

  it('should reject an unverified Google email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'test@test.com',
        email_verified: false,
        sub: 'google-sub-1',
      }),
    });

    await expect(service.googleLogin('credential')).rejects.toThrow();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('should reject a malformed Google credential', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Wrong number of segments'));

    await expect(service.googleLogin('not-a-token')).rejects.toThrow();
  });

  it('should log in an existing Google user without mutating it needlessly', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'test@test.com',
        email_verified: true,
        name: 'Test',
        picture: 'http://pic',
        sub: 'google-sub-1',
      }),
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 1,
      email: 'test@test.com',
      name: 'Test',
      photo_url: 'http://pic',
      google_token_id: 'google-sub-1',
    });
    prisma.invitation.findUnique.mockResolvedValue({
      id: 10,
      status: 'ACTIVE',
    });

    const result = await service.googleLogin('credential');

    expect(result).toEqual({ access_token: 'token' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('should reject Google login on an existing account with revoked access', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'test@test.com',
        email_verified: true,
        name: 'Test',
        picture: 'http://pic',
        sub: 'google-sub-1',
      }),
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 1,
      email: 'test@test.com',
      name: 'Test',
      photo_url: 'http://pic',
      google_token_id: 'google-sub-1',
    });
    prisma.invitation.findUnique.mockResolvedValue({
      id: 10,
      status: 'REVOKED',
    });

    await expect(service.googleLogin('credential')).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('should create a new user on first Google login with the default role', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'new@test.com',
        email_verified: true,
        name: 'New',
        picture: 'http://pic',
        sub: 'google-sub-2',
      }),
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.invitation.findUnique.mockResolvedValue({
      id: 20,
      status: 'PENDING',
    });
    prisma.role.findUnique.mockResolvedValue({ id: 5, name: 'user' });
    prisma.user.create.mockResolvedValue({
      id: 2,
      email: 'new@test.com',
      name: 'New',
      photo_url: 'http://pic',
      google_token_id: 'google-sub-2',
    });

    const result = await service.googleLogin('credential');

    expect(result).toEqual({ access_token: 'token' });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@test.com',
          google_token_id: 'google-sub-2',
          role: { connect: { id: 5 } },
        }),
      }),
    );
    expect(prisma.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 20 },
        data: expect.objectContaining({ status: 'ACTIVE', user_id: 2 }),
      }),
    );
  });

  it('should reject first Google login when the email has no pending invitation', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'ghost@test.com',
        email_verified: true,
        name: 'Ghost',
        sub: 'google-sub-3',
      }),
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.invitation.findUnique.mockResolvedValue(null);

    await expect(service.googleLogin('credential')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
