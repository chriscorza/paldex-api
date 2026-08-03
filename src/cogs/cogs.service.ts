import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCogsDto, UpdateCogsDto } from './dto/create-cogs.dto';
import { CogsEntity, COGS_PUBLIC_SELECT } from './entities/cogs.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;

@Injectable()
export class CogsService {
  constructor(private prisma: PrismaService) {}

  async findByIncome(ctx: OwnershipContext, incomeId: number) {
    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, ...buildOwnerFilter(ctx) },
    });
    if (!income) {
      throw new NotFoundException('Income not found');
    }

    const rows = await this.prisma.costOfGoodsSold.findMany({
      where: { income_id: incomeId },
      select: COGS_PUBLIC_SELECT,
      orderBy: { created_at: 'asc' },
    });

    return rows.map((r) => new CogsEntity(r));
  }

  async create(ctx: OwnershipContext, incomeId: number, dto: CreateCogsDto) {
    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, ...buildOwnerFilter(ctx) },
    });
    if (!income) {
      throw new NotFoundException('Income not found');
    }

    if (dto.quantity <= 0 || dto.unit_cost <= 0) {
      throw new BadRequestException('quantity and unit_cost must be positive');
    }

    const total_cost = new Decimal(dto.quantity).times(
      new Decimal(dto.unit_cost),
    );

    const row = await this.prisma.costOfGoodsSold.create({
      data: {
        income_id: incomeId,
        product_reference: dto.product_reference ?? null,
        quantity: dto.quantity,
        unit_cost: dto.unit_cost,
        total_cost: total_cost.toNumber(),
        source: dto.source ?? 'MANUAL',
        notes: dto.notes ?? null,
      },
      select: COGS_PUBLIC_SELECT,
    });

    await this.recalculateIncomeCogs(incomeId);

    return new CogsEntity(row);
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateCogsDto) {
    const existing = await this.prisma.costOfGoodsSold.findFirst({
      where: { id },
      include: { income: true },
    });
    if (!existing) {
      throw new NotFoundException('COGS row not found');
    }

    if (ctx.scope === 'OWN' && existing.income.user_id !== ctx.userId) {
      throw new NotFoundException('COGS row not found');
    }

    const quantity = dto.quantity ?? Number(existing.quantity);
    const unit_cost = dto.unit_cost ?? Number(existing.unit_cost);

    const total_cost = new Decimal(quantity).times(new Decimal(unit_cost));

    const row = await this.prisma.costOfGoodsSold.update({
      where: { id },
      data: {
        ...(dto.product_reference !== undefined && {
          product_reference: dto.product_reference,
        }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.unit_cost !== undefined && { unit_cost: dto.unit_cost }),
        total_cost: total_cost.toNumber(),
        ...(dto.source !== undefined && { source: dto.source }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      select: COGS_PUBLIC_SELECT,
    });

    await this.recalculateIncomeCogs(existing.income_id);

    return new CogsEntity(row);
  }

  async remove(ctx: OwnershipContext, id: number) {
    const existing = await this.prisma.costOfGoodsSold.findFirst({
      where: { id },
      include: { income: true },
    });
    if (!existing) {
      throw new NotFoundException('COGS row not found');
    }

    if (ctx.scope === 'OWN' && existing.income.user_id !== ctx.userId) {
      throw new NotFoundException('COGS row not found');
    }

    await this.prisma.costOfGoodsSold.delete({ where: { id } });
    await this.recalculateIncomeCogs(existing.income_id);
  }

  private async recalculateIncomeCogs(incomeId: number) {
    const aggregate = await this.prisma.costOfGoodsSold.aggregate({
      where: { income_id: incomeId },
      _sum: { total_cost: true },
    });

    const cogsTotal = aggregate._sum.total_cost ?? null;
    const income = await this.prisma.income.findUnique({
      where: { id: incomeId },
      select: { net_amount: true, gross_amount: true },
    });

    if (!income) return;

    const netAmount = income.net_amount ?? income.gross_amount;
    const profitGross =
      cogsTotal !== null && netAmount !== null
        ? new Decimal(netAmount).minus(new Decimal(cogsTotal)).toNumber()
        : null;

    await this.prisma.income.update({
      where: { id: incomeId },
      data: {
        cogs_total: cogsTotal,
        profit_gross: profitGross,
      },
    });
  }
}
