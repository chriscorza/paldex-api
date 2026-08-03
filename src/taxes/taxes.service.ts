import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { CreateTaxDto } from './dto/create-tax.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';
import { FilterTaxesDto } from './dto/filter-taxes.dto';
import { PaginatedTaxResponse, TaxDetail } from './entities/tax.entity';

@Injectable()
export class TaxesService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: FilterTaxesDto): Promise<PaginatedTaxResponse> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = this.buildWhere(filters);
    const orderBy = this.buildOrderBy(filters);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.tax.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tax.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number): Promise<TaxDetail> {
    const tax = await this.prisma.tax.findUnique({
      where: { id },
      include: {
        _count: { select: { incomes: true, expenses: true } },
      },
    });
    if (!tax) {
      throw new NotFoundException(`Tax with id ${id} not found`);
    }
    const { _count, ...rest } = tax;
    return {
      ...rest,
      incomes_count: _count.incomes,
      expenses_count: _count.expenses,
    };
  }

  async create(dto: CreateTaxDto) {
    const name = dto.name.trim();
    await this.assertNameAvailable(name);
    return this.prisma.tax.create({
      data: { name, rate: dto.rate },
    });
  }

  async update(id: number, dto: UpdateTaxDto) {
    const existing = await this.prisma.tax.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Tax with id ${id} not found`);
    }

    const name = dto.name !== undefined ? dto.name.trim() : undefined;
    if (name !== undefined) {
      await this.assertNameAvailable(name, id);
    }

    return this.prisma.tax.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
      },
    });
  }

  async remove(id: number) {
    const tax = await this.prisma.tax.findUnique({
      where: { id },
      include: {
        _count: { select: { incomes: true, expenses: true } },
      },
    });
    if (!tax) {
      throw new NotFoundException(`Tax with id ${id} not found`);
    }

    const incomeCount = tax._count.incomes;
    const expenseCount = tax._count.expenses;

    if (incomeCount + expenseCount > 0) {
      throw new ConflictException(
        `Cannot delete tax: used by ${incomeCount} incomes and ${expenseCount} expenses`,
      );
    }

    return this.prisma.tax.delete({ where: { id } });
  }

  private async assertNameAvailable(
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const trimmed = name.trim();
    const existing = await this.prisma.tax.findFirst({
      where: {
        name: trimmed,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
    });
    if (existing) {
      throw new ConflictException(`Tax with name "${trimmed}" already exists`);
    }
  }

  private buildWhere(filters: FilterTaxesDto): Prisma.TaxWhereInput {
    const where: Prisma.TaxWhereInput = {};
    if (filters.search) {
      where.name = { contains: filters.search };
    }
    return where;
  }

  private buildOrderBy(
    filters: FilterTaxesDto,
  ): Prisma.TaxOrderByWithRelationInput {
    const sort_by = filters.sort_by ?? 'name';
    const order = filters.order ?? 'asc';
    return { [sort_by]: order };
  }
}
