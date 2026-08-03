import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

describe('ExpensesController', () => {
  let controller: ExpensesController;
  let service: ExpensesService;

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
      controllers: [ExpensesController],
      providers: [{ provide: ExpensesService, useValue: mockService }],
    }).compile();

    controller = module.get<ExpensesController>(ExpensesController);
    service = module.get<ExpensesService>(ExpensesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should delegate to service findAll', async () => {
      const filters = { page: 1 };
      mockService.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      await controller.findAll(mockRequest, mockUser, filters);
      expect(service.findAll).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        filters,
      );
    });
  });

  describe('findOne', () => {
    it('should delegate to service findOne', async () => {
      mockService.findOne.mockResolvedValue({ id: 1 });
      await controller.findOne(mockRequest, mockUser, 1);
      expect(service.findOne).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
      );
    });
  });

  describe('create', () => {
    it('should delegate to service create', async () => {
      const dto = {
        amount: 100,
        concept: 'Test',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
      };
      await controller.create(mockRequest, mockUser, dto);
      expect(service.create).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        dto,
      );
    });
  });

  describe('update', () => {
    it('should delegate to service update', async () => {
      const dto = { amount: 200 };
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
      await controller.remove(mockRequest, mockUser, 1);
      expect(service.remove).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
      );
    });
  });
});
