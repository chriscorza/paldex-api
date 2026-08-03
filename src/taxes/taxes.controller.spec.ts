import { Test, TestingModule } from '@nestjs/testing';
import { TaxesController } from './taxes.controller';
import { TaxesService } from './taxes.service';

describe('TaxesController', () => {
  let controller: TaxesController;
  let service: TaxesService;

  const mockService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxesController],
      providers: [{ provide: TaxesService, useValue: mockService }],
    }).compile();

    controller = module.get<TaxesController>(TaxesController);
    service = module.get<TaxesService>(TaxesService);
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

      const result = await controller.findAll(filters);

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith(filters);
    });
  });

  describe('findOne', () => {
    it('should delegate to service findOne', async () => {
      const expected = {
        id: 1,
        name: 'IVA',
        rate: 21,
        incomes_count: 0,
        expenses_count: 0,
      };
      mockService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(1);

      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith(1);
    });
  });

  describe('create', () => {
    it('should delegate to service create', async () => {
      const dto = { name: 'IVA', rate: 21 };
      mockService.create.mockResolvedValue({ id: 1, ...dto });

      await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('should delegate to service update', async () => {
      const dto = { rate: 10 };
      mockService.update.mockResolvedValue({ id: 1, name: 'IVA', rate: 10 });

      await controller.update(1, dto);

      expect(service.update).toHaveBeenCalledWith(1, dto);
    });
  });

  describe('remove', () => {
    it('should delegate to service remove', async () => {
      mockService.remove.mockResolvedValue({ id: 1 });

      await controller.remove(1);

      expect(service.remove).toHaveBeenCalledWith(1);
    });
  });
});
