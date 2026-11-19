/*
 * Pre-vuelo de `add-mcp-payroll-payments`. SÓLO LECTURA.
 *
 * Reporta, por cuenta, cada ExpenseCategory con type = PAYROLL y cuántos gastos
 * (y plantillas recurrentes) la referencian. Sale con código 1 si hay alguno:
 * en ese caso la nómina está registrada dos veces y sólo una persona puede
 * decidir cuál lado se queda; la migración de retiro también aborta.
 *
 * Uso: DATABASE_URL=<destino> npx ts-node scripts/check-payroll-categories.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      'Define DATABASE_URL explícitamente (no se lee .env.prod).',
    );
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

  try {
    const categories = await prisma.expenseCategory.findMany({
      where: { type: 'PAYROLL' },
      select: {
        id: true,
        name: true,
        user_id: true,
        _count: { select: { expenses: true } },
      },
      orderBy: [{ user_id: 'asc' }, { id: 'asc' }],
    });

    let referenced = 0;
    for (const c of categories) {
      const recurring = await prisma.recurringExpense.count({
        where: { category_id: c.id },
      });
      referenced += c._count.expenses + recurring;
      console.log(
        `user ${c.user_id} · categoría ${c.id} "${c.name}": ${c._count.expenses} gastos, ${recurring} plantillas recurrentes`,
      );
    }
    console.log(
      `\n${categories.length} categorías PAYROLL, ${referenced} referencias.`,
    );
    process.exitCode = referenced > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
