import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { McpAuthorizationService } from './mcp-authorization.service';
import { PrismaService } from '../prisma.service';
import { PermissionsService } from '../permissions/permissions.service';

describe('McpAuthorizationService', () => {
  let service: McpAuthorizationService;
  let prisma: any;
  let permissionsService: any;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    permissionsService = { resolvePermissions: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpAuthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    service = module.get<McpAuthorizationService>(McpAuthorizationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('throws UnauthorizedException when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.requireContext(1, 'expense:read'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws ForbiddenException when the user has no role', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, role_id: null });

    await expect(
      service.requireContext(1, 'expense:read'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when the role lacks the permission', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, role_id: 5 });
    permissionsService.resolvePermissions.mockResolvedValue(
      new Map([['expense:create', 'OWN']]),
    );

    await expect(
      service.requireContext(1, 'expense:read'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an ANY-scoped context when the role has ANY scope', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, role_id: 5 });
    permissionsService.resolvePermissions.mockResolvedValue(
      new Map([['expense:read', 'ANY']]),
    );

    await expect(service.requireContext(1, 'expense:read')).resolves.toEqual({
      userId: 1,
      scope: 'ANY',
    });
  });

  it('returns an OWN-scoped context when the role has OWN scope', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 7, role_id: 5 });
    permissionsService.resolvePermissions.mockResolvedValue(
      new Map([['expense:create', 'OWN']]),
    );

    await expect(service.requireContext(7, 'expense:create')).resolves.toEqual({
      userId: 7,
      scope: 'OWN',
    });
  });
});
