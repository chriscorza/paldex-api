import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountType } from '@prisma/client';

describe('AccountsController', () => {
  let controller: AccountsController;
  let service: AccountsService;

  const mockRequest = { permissionScope: 'ANY' };
  const mockUser = { id: 1, email: 'test@test.com' };

  const mockService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: mockService }],
    }).compile();

    controller = module.get<AccountsController>(AccountsController);
    service = module.get<AccountsService>(AccountsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should delegate to service findAll', async () => {
      const filters = { page: 1, limit: 10 };
      const expected = { data: [], total: 0, page: 1, limit: 10 };
      mockService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(mockRequest, mockUser, filters);

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        filters,
      );
    });
  });

  describe('findOne', () => {
    it('should delegate to service findOne', async () => {
      const expected = {
        id: 1,
        name: 'Test',
        incomes_count: 0,
        expenses_count: 0,
      };
      mockService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(mockRequest, mockUser, 1);

      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
      );
    });
  });

  describe('create', () => {
    it('should delegate to service create', async () => {
      const dto = { name: 'Test', balance: 100, type: AccountType.CASH };
      mockService.create.mockResolvedValue({ id: 1, ...dto });

      await controller.create(mockRequest, mockUser, dto);

      expect(service.create).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        dto,
      );
    });
  });

  describe('update', () => {
    it('should delegate to service update', async () => {
      const dto = { name: 'Updated' };
      mockService.update.mockResolvedValue({ id: 1, name: 'Updated' });

      await controller.update(mockRequest, mockUser, 1, dto);

      expect(service.update).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
        dto,
      );
    });
  });

  describe('remove', () => {
    it('should delegate to service remove', async () => {
      mockService.remove.mockResolvedValue({ id: 1 });

      await controller.remove(mockRequest, mockUser, 1);

      expect(service.remove).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
      );
    });
  });
});
