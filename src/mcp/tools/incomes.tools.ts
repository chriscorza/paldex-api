import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpToolkit, ToolDef, clientRefSchema } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { DATE_RULE, WRITE_RULE, idArg } from './shared';
import { incomeDuplicates } from './duplicates';
import { OwnershipContext, buildOwnerFilter } from '../../common/ownership';
import { FilterIncomesDto } from '../../incomes/dto/filter-incomes.dto';
import { CreateIncomeDto } from '../../incomes/dto/create-income.dto';
import { UpdateIncomeDto } from '../../incomes/dto/update-income.dto';
import { CreateCogsDto, UpdateCogsDto } from '../../cogs/dto/create-cogs.dto';

/*
 * Un ingreso ligado a un pedido de Shopify es del sincronizador: se corrige en
 * Shopify y la siguiente sincronización lo actualiza. Si el agente lo editara,
 * la sincronización lo pisaría y nadie sabría cuál de los dos era el bueno.
 */
async function assertNotShopify(
  s: McpServices,
  ctx: OwnershipContext,
  id: number,
) {
  const income = (await s.incomes.findOne(ctx, id)) as {
    shopify_order_id?: number | null;
  };
  if (income?.shopify_order_id) {
    throw new BadRequestException(
      `El ingreso ${id} viene de Shopify: se corrige en Shopify y la siguiente sincronización lo actualiza. ` +
        'Su costo de lo vendido sí se puede capturar con cogs_create.',
    );
  }
}

async function loadCogs(s: McpServices, ctx: OwnershipContext, id: number) {
  const row = await s.prisma.costOfGoodsSold.findFirst({
    where: { id, income: { ...buildOwnerFilter(ctx) } },
  });
  if (!row) throw new NotFoundException(`COGS ${id} not found`);
  return row;
}

export function defineIncomeTools(k: McpToolkit, s: McpServices) {
  k.define({
    name: 'incomes_list',
    title: 'List incomes',
    kind: 'read',
    permission: 'income:read',
    description:
      'Ingresos del dueño de la llave, con los filtros de GET /incomes (incluye los pedidos de Shopify).',
    input: dtoToZodShape(FilterIncomesDto),
    dto: FilterIncomesDto,
    handler: (ctx, _args, dto) => s.incomes.findAll(ctx, dto),
  });

  k.define({
    name: 'income_get',
    title: 'Get income',
    kind: 'read',
    permission: 'income:read',
    description: 'Un ingreso por id, como GET /incomes/:id.',
    input: { id: idArg('Id del ingreso.') },
    handler: (ctx, args) => s.incomes.findOne(ctx, args.id),
  });

  const incomeCreate: ToolDef = k.define({
    name: 'income_create',
    title: 'Create income',
    kind: 'create',
    entity: 'income',
    permission: 'income:create',
    description:
      'Registra un ingreso manual (POST /incomes): venta fuera de Shopify, ajuste, otro ingreso. Las ventas de Shopify llegan solas: no las registres. ' +
      WRITE_RULE +
      ' ' +
      DATE_RULE,
    input: dtoToZodShape(CreateIncomeDto),
    dto: CreateIncomeDto,
    load: (ctx, id) => s.incomes.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.incomes.create(ctx, dto),
    preWarnings: (ctx, args) =>
      incomeDuplicates(s.prisma, ctx, {
        amount: args.amount,
        date: args.date,
        account_id: args.account_id,
        concept: args.concept,
      }),
    dateOf: (e) => e?.date,
  });

  k.define({
    name: 'income_update',
    title: 'Update income',
    kind: 'update',
    entity: 'income',
    permission: 'income:update',
    description:
      'Corrige un ingreso manual (PATCH /incomes/:id); manda sólo lo que cambia. Los ingresos de Shopify se rechazan.',
    input: {
      id: idArg('Id del ingreso.'),
      ...dtoToZodShape(UpdateIncomeDto, { partial: true }),
    },
    dto: UpdateIncomeDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.incomes.findOne(ctx, id),
    handler: async (ctx, args, dto) => {
      await assertNotShopify(s, ctx, args.id);
      return s.incomes.update(ctx, args.id, dto);
    },
    dateOf: (e) => e?.date,
  });

  k.define({
    name: 'income_delete',
    title: 'Delete income',
    kind: 'delete',
    entity: 'income',
    permission: 'income:delete',
    description:
      'Borra un ingreso manual que creó el agente (DELETE /incomes/:id), en dos pasos. Los de Shopify se rechazan.',
    input: { id: idArg('Id del ingreso.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.incomes.findOne(ctx, id),
    handler: async (ctx, args) => {
      await assertNotShopify(s, ctx, args.id);
      return s.incomes.remove(ctx, args.id);
    },
  });

  k.define({
    name: 'incomes_create_bulk',
    title: 'Create many incomes',
    kind: 'create',
    entity: 'income',
    permission: 'income:create',
    description:
      'Registra hasta 100 ingresos manuales de una vez, cada uno por income_create con su client_ref. Resultado por renglón y resumen.',
    input: {
      items: z
        .array(
          z.object({
            ...dtoToZodShape(CreateIncomeDto),
            client_ref: clientRefSchema,
          }),
        )
        .min(1)
        .max(100),
    },
    bulk: incomeCreate,
    handler: async () => undefined,
  });

  k.define({
    name: 'cogs_list',
    title: 'List cost of goods sold of an income',
    kind: 'read',
    permission: 'cogs:read',
    description:
      'El costo de lo vendido capturado para un ingreso (GET /incomes/:id/cogs).',
    input: { income_id: idArg('Id del ingreso.') },
    handler: (ctx, args) => s.cogs.findByIncome(ctx, args.income_id),
  });

  k.define({
    name: 'cogs_create',
    title: 'Add cost of goods sold to an income',
    kind: 'create',
    entity: 'cogs',
    permission: 'cogs:create',
    description:
      'Captura el costo de lo vendido de un ingreso (POST /incomes/:id/cogs), también de los de Shopify. Es lo que hace confiable la utilidad bruta.',
    input: {
      income_id: idArg('Id del ingreso.'),
      ...dtoToZodShape(CreateCogsDto),
    },
    dto: CreateCogsDto,
    idArgs: ['income_id'],
    load: (ctx, id) => loadCogs(s, ctx, id),
    handler: (ctx, args, dto) => s.cogs.create(ctx, args.income_id, dto),
  });

  k.define({
    name: 'cogs_update',
    title: 'Update cost of goods sold',
    kind: 'update',
    entity: 'cogs',
    permission: 'cogs:update',
    description: 'Corrige un costo de lo vendido (PATCH /cogs/:id).',
    input: {
      id: idArg('Id del registro de costo.'),
      ...dtoToZodShape(UpdateCogsDto, { partial: true }),
    },
    dto: UpdateCogsDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => loadCogs(s, ctx, id),
    handler: (ctx, args, dto) => s.cogs.update(ctx, args.id, dto),
  });

  k.define({
    name: 'cogs_delete',
    title: 'Delete cost of goods sold',
    kind: 'delete',
    entity: 'cogs',
    permission: 'cogs:delete',
    description:
      'Borra un costo de lo vendido que capturó el agente (DELETE /cogs/:id), en dos pasos.',
    input: { id: idArg('Id del registro de costo.') },
    targetId: (a) => a.id,
    load: (ctx, id) => loadCogs(s, ctx, id),
    handler: (ctx, args) => s.cogs.remove(ctx, args.id),
  });
}
