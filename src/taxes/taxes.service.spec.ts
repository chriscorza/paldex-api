import { Test, TestingModule } from '@nestjs/testing';
import { TaxesService } from './taxes.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const mockTax = {
  id: 1,
  name: 'IVA',
  rate: 21,
  created_at: new Date('2026-01-01'),
};

const mockTaxWithCount = {
  ...mockTax,
  _count: { incomes: 4, expenses: 2 },
};

describe('TaxesService', () => {
  let service: TaxesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      tax: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      incomeTax: {
        count: jest.fn(),
      },
      expenseTax: {
        count: jest.fn(),
      },
      $transaction: jest.fn((queries) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TaxesService>(TaxesService);
  });

  describe('findAll', () => {
    it('should return paginated taxes with default order name asc', async () => {
      prisma.tax.findMany.mockResolvedValue([mockTax]);
      prisma.tax.count.mockResolvedValue(3);

      const result = await service.findAll({});

      expect(result).toEqual({ data: [mockTax], total: 3, page: 1, limit: 20 });
      expect(prisma.tax.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
        skip: 0,
        take: 20,
      });
    });

    it('should apply search filter', async () => {
      prisma.tax.findMany.mockResolvedValue([]);
      prisma.tax.count.mockResolvedValue(0);

      await service.findAll({ search: 'iva' });

      expect(prisma.tax.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: { contains: 'iva' } } }),
      );
    });

    it('should apply sort_by and order', async () => {
      prisma.tax.findMany.mockResolvedValue([]);
      prisma.tax.count.mockResolvedValue(0);

      await service.findAll({ sort_by: 'rate', order: 'desc' });

      expect(prisma.tax.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { rate: 'desc' } }),
      );
    });

    it('should apply pagination', async () => {
      prisma.tax.findMany.mockResolvedValue([]);
      prisma.tax.count.mockResolvedValue(25);

      await service.findAll({ page: 2, limit: 10 });

      expect(prisma.tax.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('findOne', () => {
    it('should return tax with counts mapped', async () => {
      prisma.tax.findUnique.mockResolvedValue(mockTaxWithCount);

      const result = await service.findOne(1);

      expect(result).toEqual({
        ...mockTax,
        incomes_count: 4,
        expenses_count: 2,
      });
      expect(result).not.toHaveProperty('_count');
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.tax.findUnique.mockResolvedValue(null);

      await expect(service.findOne(9999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a tax with trimmed name', async () => {
      prisma.tax.findFirst.mockResolvedValue(null);
      prisma.tax.create.mockResolvedValue(mockTax);

      const result = await service.create({ name: ' IVA ', rate: 21 });

      expect(result).toEqual(mockTax);
      expect(prisma.tax.create).toHaveBeenCalledWith({
        data: { name: 'IVA', rate: 21 },
      });
    });

    it('should reject duplicate name', async () => {
      prisma.tax.findFirst.mockResolvedValue(mockTax);

      await expect(service.create({ name: 'IVA', rate: 10 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject name with spaces that collides', async () => {
      prisma.tax.findFirst.mockResolvedValue(mockTax);

      await expect(
        service.create({ name: '  IVA  ', rate: 10 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update rate only', async () => {
      prisma.tax.findUnique.mockResolvedValue(mockTax);
      prisma.tax.update.mockResolvedValue({ ...mockTax, rate: 15 });

      await service.update(1, { rate: 15 });

      expect(prisma.tax.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { rate: 15 },
      });
    });

    it('should update name with trim', async () => {
      prisma.tax.findUnique.mockResolvedValue(mockTax);
      prisma.tax.findFirst.mockResolvedValue(null);
      prisma.tax.update.mockResolvedValue({ ...mockTax, name: 'IRPF' });

      await service.update(1, { name: '  IRPF  ' });

      expect(prisma.tax.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'IRPF' }),
        }),
      );
    });

    it('should allow renaming to same name', async () => {
      prisma.tax.findUnique.mockResolvedValue(mockTax);
      prisma.tax.findFirst.mockResolvedValue(null);
      prisma.tax.update.mockResolvedValue(mockTax);

      const result = await service.update(1, { name: 'IVA' });

      expect(result).toBeDefined();
      expect(prisma.tax.update).toHaveBeenCalled();
    });

    it('should reject renaming to occupied name', async () => {
      prisma.tax.findUnique.mockResolvedValue(mockTax);
      prisma.tax.findFirst.mockResolvedValue({ id: 2, name: 'IRPF' });

      await expect(service.update(1, { name: 'IRPF' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.tax.findUnique.mockResolvedValue(null);

      await expect(service.update(9999, { rate: 10 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete unused tax', async () => {
      prisma.tax.findUnique.mockResolvedValue({
        ...mockTax,
        _count: { incomes: 0, expenses: 0 },
      });
      prisma.tax.delete.mockResolvedValue(mockTax);

      const result = await service.remove(1);

      expect(result).toEqual(mockTax);
    });

    it('should reject delete of tax used by incomes', async () => {
      prisma.tax.findUnique.mockResolvedValue({
        ...mockTax,
        _count: { incomes: 4, expenses: 0 },
      });

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      await expect(service.remove(1)).rejects.toThrow('4 incomes');
      expect(prisma.tax.delete).not.toHaveBeenCalled();
    });

    it('should reject delete of tax used by expenses', async () => {
      prisma.tax.findUnique.mockResolvedValue({
        ...mockTax,
        _count: { incomes: 0, expenses: 2 },
      });

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      await expect(service.remove(1)).rejects.toThrow('2 expenses');
      expect(prisma.tax.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.tax.findUnique.mockResolvedValue(null);

      await expect(service.remove(9999)).rejects.toThrow(NotFoundException);
    });
  });
});
