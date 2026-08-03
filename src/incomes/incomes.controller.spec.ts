import { Test, TestingModule } from '@nestjs/testing';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';

describe('IncomesController', () => {
  let controller: IncomesController;
  let service: IncomesService;

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
      controllers: [IncomesController],
      providers: [{ provide: IncomesService, useValue: mockService }],
    }).compile();

    controller = module.get<IncomesController>(IncomesController);
    service = module.get<IncomesService>(IncomesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should delegate to service findAll with filters', async () => {
      const filters = { page: 1, limit: 20 };
      const expected = { data: [], total: 0, page: 1, limit: 20 };
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
      const expected = { id: 1, amount: 100 };
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
      const dto = {
        amount: 100,
        concept: 'Test',
        date: '2026-01-01',
        invoiced: false,
        account_id: 1,
      };
      const expected = { id: 1, ...dto };
      mockService.create.mockResolvedValue(expected);

      const result = await controller.create(mockRequest, mockUser, dto);

      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        dto,
      );
    });
  });

  describe('update', () => {
    it('should delegate to service update', async () => {
      const dto = { amount: 200 };
      const expected = { id: 1, amount: 200 };
      mockService.update.mockResolvedValue(expected);

      const result = await controller.update(mockRequest, mockUser, 1, dto);

      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
        dto,
      );
    });
  });

  describe('remove', () => {
    it('should delegate to service remove', async () => {
      const expected = { id: 1, amount: 100 };
      mockService.remove.mockResolvedValue(expected);

      const result = await controller.remove(mockRequest, mockUser, 1);

      expect(result).toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith(
        { userId: 1, scope: 'ANY' },
        1,
      );
    });
  });
});
