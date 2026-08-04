import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CloseGuard {
  constructor(private prisma: PrismaService) {}

  async ensureOpen(userId: number, date: Date): Promise<void> {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    const close = await this.prisma.monthlyClose.findUnique({
      where: { user_id_year_month: { user_id: userId, year, month } },
      select: { status: true },
    });

    if (close && close.status === 'CLOSED') {
      throw new ConflictException(
        `Cannot modify data in closed month ${year}-${String(month).padStart(2, '0')}`,
      );
    }
  }

  async ensurePeriodOpen(userId: number, date: Date): Promise<void> {
    return this.ensureOpen(userId, date);
  }
}
