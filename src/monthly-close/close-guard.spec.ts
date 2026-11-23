import { ConflictException } from '@nestjs/common';
import { CloseGuard } from './close-guard';

describe('CloseGuard', () => {
  const guardWith = (closed: { year: number; month: number }[]) => {
    const prisma: any = {
      monthlyClose: {
        findUnique: jest.fn(({ where }) => {
          const { year, month } = where.user_id_year_month;
          return Promise.resolve(
            closed.some((c) => c.year === year && c.month === month)
              ? { status: 'CLOSED' }
              : null,
          );
        }),
      },
    };
    return new CloseGuard(prisma);
  };

  /* 31 de octubre 20:00 en CDMX = 1 de noviembre 02:00 UTC. */
  const lastEvening = new Date('2026-10-31T20:00:00-06:00');

  it('la noche del último día pertenece a ese mes en la zona del negocio', async () => {
    await expect(
      guardWith([{ year: 2026, month: 10 }]).ensureOpen(1, lastEvening),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('no bloquea el mes siguiente por esa misma fecha', async () => {
    await expect(
      guardWith([{ year: 2026, month: 11 }]).ensureOpen(1, lastEvening),
    ).resolves.toBeUndefined();
  });
});
