import { z } from 'zod';
import { McpToolkit, ToolDef, clientRefSchema } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { DATE_RULE, WRITE_RULE, idArg, pageInput } from './shared';
import { expenseDuplicates } from './duplicates';
import { FilterExpensesDto } from '../../expenses/dto/filter-expenses.dto';
import {
  CreateExpenseDto,
  PayExpenseDto,
} from '../../expenses/dto/create-expense.dto';
import { UpdateExpenseDto } from '../../expenses/dto/update-expense.dto';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from '../../recurring-expenses/dto/recurring-expense.dto';

const expenseDate = (e: any) => e?.paid_at ?? e?.date;

export function defineExpenseTools(k: McpToolkit, s: McpServices) {
  k.define({
    name: 'expenses_list',
    title: 'List expenses',
    kind: 'read',
    permission: 'expense:read',
    description:
      'Gastos del dueño de la llave, con los mismos filtros y el mismo sobre paginado que GET /expenses.',
    input: dtoToZodShape(FilterExpensesDto),
    dto: FilterExpensesDto,
    handler: (ctx, _args, dto) => s.expenses.findAll(ctx, dto),
  });

  k.define({
    name: 'expense_get',
    title: 'Get expense',
    kind: 'read',
    permission: 'expense:read',
    description: 'Un gasto por id, como GET /expenses/:id.',
    input: { id: idArg('Id del gasto.') },
    handler: (ctx, args) => s.expenses.findOne(ctx, args.id),
  });

  const expenseCreate: ToolDef = k.define({
    name: 'expense_create',
    title: 'Create expense',
    kind: 'create',
    entity: 'expense',
    permission: 'expense:create',
    description:
      'Registra un gasto (POST /expenses). ' +
      WRITE_RULE +
      ' La nómina NO es gasto (usa payroll_*); la compra de un activo fijo va en la categoría CAPEX "Compra de activo fijo". ' +
      DATE_RULE,
    input: dtoToZodShape(CreateExpenseDto),
    dto: CreateExpenseDto,
    load: (ctx, id) => s.expenses.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.expenses.create(ctx, dto),
    preWarnings: (ctx, args) =>
      expenseDuplicates(s.prisma, ctx, {
        amount: args.amount,
        date: args.date,
        account_id: args.account_id,
        vendor: args.vendor,
        concept: args.concept,
      }),
    dateOf: expenseDate,
  });

  k.define({
    name: 'expense_update',
    title: 'Update expense',
    kind: 'update',
    entity: 'expense',
    permission: 'expense:update',
    description:
      'Corrige un gasto (PATCH /expenses/:id): manda sólo los campos que cambian. Puede editar cualquier gasto del dueño, ' +
      'incluso los capturados en la app.',
    input: {
      id: idArg('Id del gasto.'),
      ...dtoToZodShape(UpdateExpenseDto, { partial: true }),
    },
    dto: UpdateExpenseDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.expenses.findOne(ctx, id),
    handler: (ctx, args, dto) => s.expenses.update(ctx, args.id, dto),
    dateOf: expenseDate,
  });

  k.define({
    name: 'expense_pay',
    title: 'Mark expense as paid',
    kind: 'action',
    action: 'pay',
    entity: 'expense',
    permission: 'expense:update',
    description:
      'Marca como pagado un gasto pendiente (POST /expenses/:id/pay). La fecha y la cuenta de pago las sabe el usuario: no las supongas.',
    input: { id: idArg('Id del gasto.'), ...dtoToZodShape(PayExpenseDto) },
    dto: PayExpenseDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.expenses.findOne(ctx, id),
    handler: (ctx, args, dto) => s.expenses.pay(ctx, args.id, dto),
    dateOf: expenseDate,
  });

  k.define({
    name: 'expense_delete',
    title: 'Delete expense',
    kind: 'delete',
    entity: 'expense',
    permission: 'expense:delete',
    description:
      'Borra un gasto que creó el agente (DELETE /expenses/:id), en dos pasos: sin confirmation_token devuelve la vista previa. ' +
      'Lo capturado en la app no se puede borrar desde aquí.',
    input: { id: idArg('Id del gasto.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.expenses.findOne(ctx, id),
    handler: (ctx, args) => s.expenses.remove(ctx, args.id),
  });

  k.define({
    name: 'expenses_create_bulk',
    title: 'Create many expenses',
    kind: 'create',
    entity: 'expense',
    permission: 'expense:create',
    description:
      'Registra hasta 100 gastos de una vez (estado de cuenta, varios tickets). Cada uno pasa por expense_create y lleva su propio ' +
      'client_ref: si reenvías el lote, sólo entra lo que no estaba. Devuelve un resultado por renglón (created, duplicate o error) y un resumen; ' +
      'un renglón con error no detiene a los demás.',
    input: {
      items: z
        .array(
          z.object({
            ...dtoToZodShape(CreateExpenseDto),
            client_ref: clientRefSchema,
          }),
        )
        .min(1)
        .max(100),
    },
    bulk: expenseCreate,
    handler: async () => undefined,
  });

  k.define({
    name: 'recurring_expenses_list',
    title: 'List recurring expenses',
    kind: 'read',
    permission: 'recurring_expense:read',
    description:
      'Plantillas de gastos recurrentes (renta, servicios), como GET /recurring-expenses.',
    input: pageInput,
    handler: (ctx, args) =>
      s.recurringExpenses.findAll(ctx, args.page ?? 1, args.limit ?? 50),
  });

  k.define({
    name: 'recurring_expense_create',
    title: 'Create recurring expense',
    kind: 'create',
    entity: 'recurring_expense',
    permission: 'recurring_expense:create',
    description:
      'Crea una plantilla de gasto recurrente (POST /recurring-expenses); el sistema genera cada gasto pendiente en su fecha. ' +
      WRITE_RULE,
    input: dtoToZodShape(CreateRecurringExpenseDto),
    dto: CreateRecurringExpenseDto,
    load: (ctx, id) => s.recurringExpenses.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.recurringExpenses.create(ctx, dto),
  });

  k.define({
    name: 'recurring_expense_update',
    title: 'Update recurring expense',
    kind: 'update',
    entity: 'recurring_expense',
    permission: 'recurring_expense:update',
    description:
      'Cambia una plantilla recurrente (PATCH /recurring-expenses/:id). No toca los gastos ya generados.',
    input: {
      id: idArg('Id de la plantilla.'),
      ...dtoToZodShape(UpdateRecurringExpenseDto, { partial: true }),
    },
    dto: UpdateRecurringExpenseDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.recurringExpenses.findOne(ctx, id),
    handler: (ctx, args, dto) => s.recurringExpenses.update(ctx, args.id, dto),
  });

  k.define({
    name: 'recurring_expense_delete',
    title: 'Delete recurring expense',
    kind: 'delete',
    entity: 'recurring_expense',
    permission: 'recurring_expense:delete',
    description:
      'Borra una plantilla recurrente que creó el agente (DELETE /recurring-expenses/:id), en dos pasos. Los gastos ya generados se quedan.',
    input: { id: idArg('Id de la plantilla.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.recurringExpenses.findOne(ctx, id),
    handler: (ctx, args) => s.recurringExpenses.remove(ctx, args.id),
  });
}
