import { Prisma } from '@prisma/client';
import { OwnershipContext, effectiveOwnerId } from '../../common/ownership';
import { PrismaService } from '../../prisma.service';
import { ToolWarning } from '../toolkit';

/*
 * Posibles duplicados sin `client_ref`: mismo monto, fecha a ±3 días y misma
 * cuenta, proveedor o concepto normalizado. Avisa, nunca bloquea: dos cafés
 * iguales el mismo día son legítimos. La protección real es `client_ref`.
 */

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 3;

export const normalize = (text: string | null | undefined): string =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

interface Candidate {
  id: number;
  concept: string;
  account_id: number;
  vendor?: string | null;
}

const matches = (
  row: Candidate,
  input: { account_id?: number; vendor?: string | null; concept?: string },
) =>
  (input.account_id !== undefined && row.account_id === input.account_id) ||
  (Boolean(input.vendor) &&
    normalize(row.vendor) === normalize(input.vendor)) ||
  (Boolean(input.concept) &&
    normalize(row.concept) === normalize(input.concept));

const warning = (what: string, ids: number[]): ToolWarning[] =>
  ids.length
    ? [
        {
          code: 'POSSIBLE_DUPLICATE',
          ids,
          message:
            `Se registró, pero ya había ${what} parecido (mismo monto, fecha cercana): ids ${ids.join(', ')}. ` +
            'Coméntaselo al usuario por si es el mismo.',
        },
      ]
    : [];

export async function expenseDuplicates(
  prisma: PrismaService,
  ctx: OwnershipContext,
  input: {
    amount: number;
    date: string;
    account_id?: number;
    vendor?: string | null;
    concept?: string;
  },
): Promise<ToolWarning[]> {
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) return [];
  const rows = await prisma.expense.findMany({
    where: {
      user_id: effectiveOwnerId(ctx),
      amount: new Prisma.Decimal(input.amount),
      date: {
        gte: new Date(date.getTime() - WINDOW_DAYS * DAY),
        lte: new Date(date.getTime() + WINDOW_DAYS * DAY),
      },
    },
    select: { id: true, concept: true, account_id: true, vendor: true },
    take: 20,
  });
  return warning(
    'un gasto',
    rows.filter((r) => matches(r, input)).map((r) => r.id),
  );
}

export async function incomeDuplicates(
  prisma: PrismaService,
  ctx: OwnershipContext,
  input: {
    amount: number;
    date: string;
    account_id?: number;
    concept?: string;
  },
): Promise<ToolWarning[]> {
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) return [];
  const rows = await prisma.income.findMany({
    where: {
      user_id: effectiveOwnerId(ctx),
      amount: new Prisma.Decimal(input.amount),
      date: {
        gte: new Date(date.getTime() - WINDOW_DAYS * DAY),
        lte: new Date(date.getTime() + WINDOW_DAYS * DAY),
      },
    },
    select: { id: true, concept: true, account_id: true },
    take: 20,
  });
  return warning(
    'un ingreso',
    rows.filter((r) => matches(r, input)).map((r) => r.id),
  );
}
