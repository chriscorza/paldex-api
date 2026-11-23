import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { dateKeyInZone } from '../common/timezone';

@Injectable()
export class CloseGuard {
  constructor(private prisma: PrismaService) {}

  /*
   * El mes se toma en la zona del negocio. Con `getMonth()` —zona del servidor,
   * UTC en el contenedor— la noche del último día de un mes en CDMX caía en el
   * mes siguiente, y un mes cerrado dejaba pasar escrituras de su último día.
   */
  async ensureOpen(userId: number, date: Date): Promise<void> {
    const [year, month] = dateKeyInZone(date).split('-').map(Number);

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
