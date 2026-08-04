import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { AddReceivableCollectionDto } from './dto/add-receivable-collection.dto';

@Injectable()
export class ReceivablesService {
  constructor(private prisma: PrismaService) {}

  async findAll(ctx: OwnershipContext, filters: any) {
    const where: any = { ...buildOwnerFilter(ctx) };
    if (filters.status) where.status = filters.status;
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.receivable.findMany({
        where,
        include: { collections: true },
        skip,
        take: limit,
        orderBy: { due_date: 'desc' },
      }),
      this.prisma.receivable.count({ where }),
    ]);
    const now = new Date();
    return {
      data: data.map((r: any) => ({
        ...r,
        collected_amount: Number(r.collected_amount),
        total_amount: Number(r.total_amount),
        remaining_amount: Number(r.total_amount) - Number(r.collected_amount),
        days_overdue:
          r.status === 'COLLECTED' || r.status === 'CANCELLED'
            ? null
            : r.due_date < now
              ? Math.floor((now.getTime() - r.due_date.getTime()) / 86400000)
              : 0,
        status:
          r.status !== 'COLLECTED' &&
          r.status !== 'CANCELLED' &&
          r.due_date < now
            ? 'OVERDUE'
            : r.status,
      })),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const r = await this.prisma.receivable.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: { collections: true },
    });
    if (!r) throw new NotFoundException('Receivable not found');
    return {
      ...r,
      collected_amount: Number(r.collected_amount),
      total_amount: Number(r.total_amount),
      remaining_amount: Number(r.total_amount) - Number(r.collected_amount),
    };
  }

  async create(ctx: OwnershipContext, dto: CreateReceivableDto) {
    return this.prisma.receivable.create({
      data: {
        customer: dto.customer,
        concept: dto.concept,
        total_amount: dto.total_amount,
        due_date: new Date(dto.due_date),
        related_income_id: dto.related_income_id ?? null,
        notes: dto.notes ?? null,
        user_id: ctx.userId,
        collected_amount: 0,
      },
    });
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateReceivableDto) {
    await this.findOne(ctx, id);
    const updateData: any = {};
    if (dto.customer !== undefined) updateData.customer = dto.customer;
    if (dto.concept !== undefined) updateData.concept = dto.concept;
    if (dto.total_amount !== undefined)
      updateData.total_amount = dto.total_amount;
    if (dto.due_date !== undefined)
      updateData.due_date = new Date(dto.due_date);
    if (dto.related_income_id !== undefined)
      updateData.related_income_id = dto.related_income_id;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    return this.prisma.receivable.update({ where: { id }, data: updateData });
  }

  async remove(ctx: OwnershipContext, id: number) {
    const r = (await this.findOne(ctx, id)) as any;
    if (r.collections?.length > 0)
      throw new ConflictException('Cannot delete receivable with collections');
    await this.prisma.receivable.delete({ where: { id } });
  }

  async addCollection(
    ctx: OwnershipContext,
    id: number,
    dto: AddReceivableCollectionDto,
  ) {
    const r = await this.prisma.receivable.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!r) throw new NotFoundException('Receivable not found');
    const remaining = Number(r.total_amount) - Number(r.collected_amount);
    if (dto.amount > remaining)
      throw new BadRequestException(
        `Collection exceeds remaining balance of ${remaining}`,
      );
    const coll = await this.prisma.receivableCollection.create({
      data: {
        receivable_id: id,
        amount: dto.amount,
        collected_at: dto.collected_at
          ? new Date(dto.collected_at)
          : new Date(),
        account_id: dto.account_id,
        notes: dto.notes,
      },
    });
    const newCollected = Number(r.collected_amount) + dto.amount;
    const total = Number(r.total_amount);
    const newStatus =
      newCollected >= total
        ? 'COLLECTED'
        : newCollected > 0
          ? 'PARTIAL'
          : 'PENDING';
    await this.prisma.receivable.update({
      where: { id },
      data: { collected_amount: newCollected, status: newStatus },
    });
    return coll;
  }

  async removeCollection(collectionId: number) {
    const rc = await this.prisma.receivableCollection.findUnique({
      where: { id: collectionId },
    });
    if (!rc) throw new NotFoundException('Collection not found');
    const r = await this.prisma.receivable.findUnique({
      where: { id: rc.receivable_id },
    });
    if (!r) throw new NotFoundException('Receivable not found');
    const newCollected = Number(r.collected_amount) - Number(rc.amount);
    const total = Number(r.total_amount);
    const newStatus =
      newCollected >= total
        ? 'COLLECTED'
        : newCollected > 0
          ? 'PARTIAL'
          : 'PENDING';
    await this.prisma.receivableCollection.delete({
      where: { id: collectionId },
    });
    await this.prisma.receivable.update({
      where: { id: rc.receivable_id },
      data: { collected_amount: newCollected, status: newStatus },
    });
  }
}
