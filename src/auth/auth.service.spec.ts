import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
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
});
