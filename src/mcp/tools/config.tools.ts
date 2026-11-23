import { McpToolkit } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { idArg } from './shared';
import { CreateAccountDto } from '../../accounts/dto/create-account.dto';
import { UpdateAccountDto } from '../../accounts/dto/update-account.dto';
import { FilterAccountsDto } from '../../accounts/dto/filter-accounts.dto';
import {
  CreateExpenseCategoryDto,
  FilterExpenseCategoriesDto,
  UpdateExpenseCategoryDto,
} from '../../expense-categories/dto/create-expense-category.dto';

/* Configuración que el dueño autorizó para el agente: cuentas y categorías. */
export function defineConfigTools(k: McpToolkit, s: McpServices) {
  k.define({
    name: 'accounts_list',
    title: 'List accounts',
    kind: 'read',
    permission: 'account:read',
    description:
      'Cuentas del dueño (efectivo, tarjetas, bancos) con su saldo (GET /accounts).',
    input: dtoToZodShape(FilterAccountsDto),
    dto: FilterAccountsDto,
    handler: (ctx, _args, dto) => s.accounts.findAll(ctx, dto),
  });

  k.define({
    name: 'account_create',
    title: 'Create account',
    kind: 'create',
    entity: 'account',
    permission: 'account:create',
    description:
      'Crea una cuenta (POST /accounts): efectivo, tarjeta de débito o crédito, otra.',
    input: dtoToZodShape(CreateAccountDto),
    dto: CreateAccountDto,
    load: (ctx, id) => s.accounts.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.accounts.create(ctx, dto),
  });

  k.define({
    name: 'account_update',
    title: 'Update account',
    kind: 'update',
    entity: 'account',
    permission: 'account:update',
    description:
      'Cambia una cuenta (PATCH /accounts/:id): nombre, tipo, límite de crédito.',
    input: {
      id: idArg('Id de la cuenta.'),
      ...dtoToZodShape(UpdateAccountDto, { partial: true }),
    },
    dto: UpdateAccountDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.accounts.findOne(ctx, id),
    handler: (ctx, args, dto) => s.accounts.update(ctx, args.id, dto),
  });

  k.define({
    name: 'account_delete',
    title: 'Delete account',
    kind: 'delete',
    entity: 'account',
    permission: 'account:delete',
    description:
      'Borra una cuenta que creó el agente (DELETE /accounts/:id), en dos pasos. Con movimientos se rechaza.',
    input: { id: idArg('Id de la cuenta.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.accounts.findOne(ctx, id),
    handler: (ctx, args) => s.accounts.remove(ctx, args.id),
  });

  k.define({
    name: 'expense_categories_list',
    title: 'List expense categories',
    kind: 'read',
    permission: 'expense_category:read',
    description:
      'Categorías de gasto con su tipo (OPERATING, MARKETING, CAPEX, INTEREST…) y cómo afectan la utilidad (GET /expense-categories).',
    input: dtoToZodShape(FilterExpenseCategoriesDto),
    dto: FilterExpenseCategoriesDto,
    handler: (ctx, _args, dto) => s.expenseCategories.findAll(ctx, dto),
  });

  k.define({
    name: 'expense_category_create',
    title: 'Create expense category',
    kind: 'create',
    entity: 'expense_category',
    permission: 'expense_category:create',
    description:
      'Crea una categoría de gasto (POST /expense-categories). El tipo decide en qué renglón del estado de resultados cae: ' +
      'OPERATING/MARKETING/OTHER restan en la operación, INTEREST abajo del EBIT, CAPEX es compra de activo (no gasto), ' +
      'COGS es compra de inventario, OWNER y DEBT son movimientos de efectivo. PAYROLL no se permite (la nómina va por payroll_*).',
    input: dtoToZodShape(CreateExpenseCategoryDto),
    dto: CreateExpenseCategoryDto,
    load: (ctx, id) => s.expenseCategories.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.expenseCategories.create(ctx, dto),
  });

  k.define({
    name: 'expense_category_update',
    title: 'Update expense category',
    kind: 'update',
    entity: 'expense_category',
    permission: 'expense_category:update',
    description:
      'Cambia una categoría propia (PATCH /expense-categories/:id). Las del sistema no se pueden editar. Cambiar el tipo mueve sus gastos de renglón en todos los meses.',
    input: {
      id: idArg('Id de la categoría.'),
      ...dtoToZodShape(UpdateExpenseCategoryDto, { partial: true }),
    },
    dto: UpdateExpenseCategoryDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.expenseCategories.findOne(ctx, id),
    handler: (ctx, args, dto) => s.expenseCategories.update(ctx, args.id, dto),
  });

  k.define({
    name: 'expense_category_delete',
    title: 'Delete expense category',
    kind: 'delete',
    entity: 'expense_category',
    permission: 'expense_category:delete',
    description:
      'Borra una categoría que creó el agente (DELETE /expense-categories/:id), en dos pasos. Las del sistema y las que tienen gastos se rechazan.',
    input: { id: idArg('Id de la categoría.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.expenseCategories.findOne(ctx, id),
    handler: (ctx, args) => s.expenseCategories.remove(ctx, args.id),
  });
}
