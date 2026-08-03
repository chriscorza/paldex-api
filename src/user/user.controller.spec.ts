import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma.service';

describe('UserController', () => {
  let controller: UserController;
  let service: UserService;

  const mockUser = { id: 1, email: 'test@test.com' };
  const mockService = {
    findMe: jest.fn(),
    updateMe: jest.fn(),
    removeMe: jest.fn(),
    findAll: jest.fn(),
    assignRole: jest.fn(),
  };
  const mockPermissionsService = {
    resolvePermissions: jest.fn(),
  };
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    service = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findMe', () => {
    it('should delegate with user.id from CurrentUser', async () => {
      mockService.findMe.mockResolvedValue({ id: 1, name: 'Test' });

      await controller.findMe(mockUser);

      expect(service.findMe).toHaveBeenCalledWith(1);
    });
  });

  describe('updateMe', () => {
    it('should delegate with user.id and dto', async () => {
      const dto = { name: 'New' };
      mockService.updateMe.mockResolvedValue({ id: 1, name: 'New' });

      await controller.updateMe(mockUser, dto);

      expect(service.updateMe).toHaveBeenCalledWith(1, dto);
    });
  });

  describe('removeMe', () => {
    it('should delegate with user.id', async () => {
      mockService.removeMe.mockResolvedValue({ id: 1 });

      await controller.removeMe(mockUser);

      expect(service.removeMe).toHaveBeenCalledWith(1);
    });
  });

  describe('getPermissions', () => {
    it('should return empty object when user has no role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await controller.getPermissions(mockUser);

      expect(result).toEqual({});
    });

    it('should return resolved permissions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ role_id: 2 });
      mockPermissionsService.resolvePermissions.mockResolvedValue(
        new Map([['income:read', 'OWN']]),
      );

      const result = await controller.getPermissions(mockUser);

      expect(result).toEqual({ 'income:read': 'OWN' });
    });
  });
});
