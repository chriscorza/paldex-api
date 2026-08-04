import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { AddPayablePaymentDto } from './dto/add-payable-payment.dto';

@Injectable()
export class PayablesService {
  constructor(private prisma: PrismaService) {}

  async findAll(ctx: OwnershipContext, filters: any) {
    const where: any = { ...buildOwnerFilter(ctx) };
    if (filters.status) where.status = filters.status;
    if (filters.vendor) where.vendor = { contains: filters.vendor };
    if (filters.start_date)
      where.due_date = {
        ...(where.due_date || {}),
        gte: new Date(filters.start_date),
      };
    if (filters.end_date)
      where.due_date = {
        ...(where.due_date || {}),
        lte: new Date(filters.end_date),
      };
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payable.findMany({
        where,
        include: { payments: true },
        skip,
        take: limit,
        orderBy: { due_date: 'desc' },
      }),
      this.prisma.payable.count({ where }),
    ]);
    const now = new Date();
    return {
      data: data.map((p: any) => ({
        ...p,
        paid_amount: Number(p.paid_amount),
        total_amount: Number(p.total_amount),
        remaining_amount: Number(p.total_amount) - Number(p.paid_amount),
        days_overdue:
          p.status === 'PAID' || p.status === 'CANCELLED'
            ? null
            : p.due_date < now
              ? Math.floor((now.getTime() - p.due_date.getTime()) / 86400000)
              : 0,
        status:
          p.status !== 'PAID' && p.status !== 'CANCELLED' && p.due_date < now
            ? 'OVERDUE'
            : p.status,
      })),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const p = await this.prisma.payable.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      include: { payments: true },
    });
    if (!p) throw new NotFoundException('Payable not found');
    return {
      ...p,
      paid_amount: Number(p.paid_amount),
      total_amount: Number(p.total_amount),
      remaining_amount: Number(p.total_amount) - Number(p.paid_amount),
    };
  }

  async create(ctx: OwnershipContext, dto: CreatePayableDto) {
    return this.prisma.payable.create({
      data: {
        vendor: dto.vendor,
        concept: dto.concept,
        total_amount: dto.total_amount,
        due_date: new Date(dto.due_date),
        account_id: dto.account_id ?? null,
        notes: dto.notes ?? null,
        user_id: ctx.userId,
        paid_amount: 0,
      },
    });
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdatePayableDto) {
    await this.findOne(ctx, id);
    const updateData: any = {};
    if (dto.vendor !== undefined) updateData.vendor = dto.vendor;
    if (dto.concept !== undefined) updateData.concept = dto.concept;
    if (dto.total_amount !== undefined)
      updateData.total_amount = dto.total_amount;
    if (dto.due_date !== undefined)
      updateData.due_date = new Date(dto.due_date);
    if (dto.account_id !== undefined) updateData.account_id = dto.account_id;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    return this.prisma.payable.update({ where: { id }, data: updateData });
  }

  async remove(ctx: OwnershipContext, id: number) {
    const p = (await this.findOne(ctx, id)) as any;
    if (p.payments?.length > 0)
      throw new ConflictException('Cannot delete payable with payments');
    await this.prisma.payable.delete({ where: { id } });
  }

  async addPayment(
    ctx: OwnershipContext,
    id: number,
    dto: AddPayablePaymentDto,
  ) {
    const p = await this.prisma.payable.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!p) throw new NotFoundException('Payable not found');
    const remaining = Number(p.total_amount) - Number(p.paid_amount);
    if (dto.amount > remaining)
      throw new BadRequestException(
        `Payment exceeds remaining balance of ${remaining}`,
      );
    const payment = await this.prisma.payablePayment.create({
      data: {
        payable_id: id,
        amount: dto.amount,
        paid_at: dto.paid_at ? new Date(dto.paid_at) : new Date(),
        account_id: dto.account_id,
        notes: dto.notes,
      },
    });
    const newPaid = Number(p.paid_amount) + dto.amount;
    const total = Number(p.total_amount);
    const newStatus =
      newPaid >= total ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';
    await this.prisma.payable.update({
      where: { id },
      data: { paid_amount: newPaid, status: newStatus },
    });
    return payment;
  }

  async removePayment(paymentId: number) {
    const pp = await this.prisma.payablePayment.findUnique({
      where: { id: paymentId },
    });
    if (!pp) throw new NotFoundException('Payment not found');
    const p = await this.prisma.payable.findUnique({
      where: { id: pp.payable_id },
    });
    if (!p) throw new NotFoundException('Payable not found');
    const newPaid = Number(p.paid_amount) - Number(pp.amount);
    const total = Number(p.total_amount);
    const newStatus =
      newPaid >= total ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';
    await this.prisma.payablePayment.delete({ where: { id: paymentId } });
    await this.prisma.payable.update({
      where: { id: pp.payable_id },
      data: { paid_amount: newPaid, status: newStatus },
    });
  }
}
