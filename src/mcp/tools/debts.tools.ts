import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PayableStatus, ReceivableStatus } from '@prisma/client';
import { McpToolkit } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { DATE_RULE, WRITE_RULE, idArg, isoDate, pageInput } from './shared';
import { OwnershipContext, buildOwnerFilter } from '../../common/ownership';
import { CreatePayableDto } from '../../payables/dto/create-payable.dto';
import { UpdatePayableDto } from '../../payables/dto/update-payable.dto';
import { AddPayablePaymentDto } from '../../payables/dto/add-payable-payment.dto';
import { CreateReceivableDto } from '../../receivables/dto/create-receivable.dto';
import { UpdateReceivableDto } from '../../receivables/dto/update-receivable.dto';
import { AddReceivableCollectionDto } from '../../receivables/dto/add-receivable-collection.dto';

async function loadPayment(s: McpServices, ctx: OwnershipContext, id: number) {
  const row = await s.prisma.payablePayment.findFirst({
    where: { id, payable: { ...buildOwnerFilter(ctx) } },
  });
  if (!row) throw new NotFoundException(`Payable payment ${id} not found`);
  return row;
}

async function loadCollection(
  s: McpServices,
  ctx: OwnershipContext,
  id: number,
) {
  const row = await s.prisma.receivableCollection.findFirst({
    where: { id, receivable: { ...buildOwnerFilter(ctx) } },
  });
  if (!row)
    throw new NotFoundException(`Receivable collection ${id} not found`);
  return row;
}

export function defineDebtTools(k: McpToolkit, s: McpServices) {
  /* ---- Cuentas por pagar ---- */
  k.define({
    name: 'payables_list',
    title: 'List payables',
    kind: 'read',
    permission: 'payable:read',
    description:
      'Cuentas por pagar (facturas de proveedores, deudas) con sus pagos y saldo, como GET /payables. Las vencidas salen como OVERDUE.',
    input: {
      status: z.nativeEnum(PayableStatus).optional(),
      vendor: z.string().optional().describe('Busca por proveedor (contiene).'),
      start_date: isoDate('Vencimiento desde, YYYY-MM-DD.').optional(),
      end_date: isoDate('Vencimiento hasta, YYYY-MM-DD.').optional(),
      ...pageInput,
    },
    handler: (ctx, args) => s.payables.findAll(ctx, args),
  });

  k.define({
    name: 'payable_get',
    title: 'Get payable',
    kind: 'read',
    permission: 'payable:read',
    description: 'Una cuenta por pagar con sus pagos (GET /payables/:id).',
    input: { id: idArg('Id de la cuenta por pagar.') },
    handler: (ctx, args) => s.payables.findOne(ctx, args.id),
  });

  k.define({
    name: 'payable_create',
    title: 'Create payable',
    kind: 'create',
    entity: 'payable',
    permission: 'payable:create',
    description:
      'Registra algo que el negocio debe pagar (POST /payables): factura de proveedor, préstamo, compra a crédito. ' +
      'No es gasto todavía: cuando se pague, usa payable_add_payment. ' +
      WRITE_RULE +
      ' ' +
      DATE_RULE,
    input: dtoToZodShape(CreatePayableDto),
    dto: CreatePayableDto,
    load: (ctx, id) => s.payables.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.payables.create(ctx, dto),
  });

  k.define({
    name: 'payable_update',
    title: 'Update payable',
    kind: 'update',
    entity: 'payable',
    permission: 'payable:update',
    description:
      'Corrige una cuenta por pagar (PATCH /payables/:id); manda sólo lo que cambia.',
    input: {
      id: idArg('Id de la cuenta por pagar.'),
      ...dtoToZodShape(UpdatePayableDto, { partial: true }),
    },
    dto: UpdatePayableDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.payables.findOne(ctx, id),
    handler: (ctx, args, dto) => s.payables.update(ctx, args.id, dto),
  });

  k.define({
    name: 'payable_add_payment',
    title: 'Pay a payable',
    kind: 'create',
    entity: 'payable_payment',
    permission: 'payable:update',
    description:
      'Registra un pago (total o parcial) a una cuenta por pagar (POST /payables/:id/payments). No puede exceder el saldo. ' +
      'La fecha y la cuenta de pago las sabe el usuario.',
    input: {
      payable_id: idArg('Id de la cuenta por pagar.'),
      ...dtoToZodShape(AddPayablePaymentDto),
    },
    dto: AddPayablePaymentDto,
    idArgs: ['payable_id'],
    load: (ctx, id) => loadPayment(s, ctx, id),
    handler: (ctx, args, dto) =>
      s.payables.addPayment(ctx, args.payable_id, dto),
    dateOf: (e) => e?.paid_at,
  });

  k.define({
    name: 'payable_payment_delete',
    title: 'Delete payable payment',
    kind: 'delete',
    entity: 'payable_payment',
    permission: 'payable:update',
    description:
      'Borra un pago a cuenta por pagar que registró el agente (DELETE /payables/payments/:id), en dos pasos; el saldo se recalcula.',
    input: { id: idArg('Id del pago.') },
    targetId: (a) => a.id,
    load: (ctx, id) => loadPayment(s, ctx, id),
    handler: (ctx, args) => s.payables.removePayment(ctx, args.id),
  });

  k.define({
    name: 'payable_delete',
    title: 'Delete payable',
    kind: 'delete',
    entity: 'payable',
    permission: 'payable:delete',
    description:
      'Borra una cuenta por pagar que creó el agente (DELETE /payables/:id), en dos pasos. Si ya tiene pagos se rechaza: borra antes los pagos.',
    input: { id: idArg('Id de la cuenta por pagar.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.payables.findOne(ctx, id),
    handler: (ctx, args) => s.payables.remove(ctx, args.id),
  });

  /* ---- Cuentas por cobrar ---- */
  k.define({
    name: 'receivables_list',
    title: 'List receivables',
    kind: 'read',
    permission: 'receivable:read',
    description:
      'Cuentas por cobrar (lo que le deben al negocio) con sus cobros, como GET /receivables.',
    input: { status: z.nativeEnum(ReceivableStatus).optional(), ...pageInput },
    handler: (ctx, args) => s.receivables.findAll(ctx, args),
  });

  k.define({
    name: 'receivable_get',
    title: 'Get receivable',
    kind: 'read',
    permission: 'receivable:read',
    description: 'Una cuenta por cobrar con sus cobros (GET /receivables/:id).',
    input: { id: idArg('Id de la cuenta por cobrar.') },
    handler: (ctx, args) => s.receivables.findOne(ctx, args.id),
  });

  k.define({
    name: 'receivable_create',
    title: 'Create receivable',
    kind: 'create',
    entity: 'receivable',
    permission: 'receivable:create',
    description:
      'Registra algo que le deben al negocio (POST /receivables): venta a crédito, préstamo a un tercero. Cuando cobren, usa receivable_add_collection. ' +
      WRITE_RULE +
      ' ' +
      DATE_RULE,
    input: dtoToZodShape(CreateReceivableDto),
    dto: CreateReceivableDto,
    load: (ctx, id) => s.receivables.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.receivables.create(ctx, dto),
  });

  k.define({
    name: 'receivable_update',
    title: 'Update receivable',
    kind: 'update',
    entity: 'receivable',
    permission: 'receivable:update',
    description:
      'Corrige una cuenta por cobrar (PATCH /receivables/:id); manda sólo lo que cambia.',
    input: {
      id: idArg('Id de la cuenta por cobrar.'),
      ...dtoToZodShape(UpdateReceivableDto, { partial: true }),
    },
    dto: UpdateReceivableDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.receivables.findOne(ctx, id),
    handler: (ctx, args, dto) => s.receivables.update(ctx, args.id, dto),
  });

  k.define({
    name: 'receivable_add_collection',
    title: 'Collect a receivable',
    kind: 'create',
    entity: 'receivable_collection',
    permission: 'receivable:update',
    description:
      'Registra un cobro (total o parcial) de una cuenta por cobrar (POST /receivables/:id/collections). No puede exceder el saldo.',
    input: {
      receivable_id: idArg('Id de la cuenta por cobrar.'),
      ...dtoToZodShape(AddReceivableCollectionDto),
    },
    dto: AddReceivableCollectionDto,
    idArgs: ['receivable_id'],
    load: (ctx, id) => loadCollection(s, ctx, id),
    handler: (ctx, args, dto) =>
      s.receivables.addCollection(ctx, args.receivable_id, dto),
    dateOf: (e) => e?.collected_at,
  });

  k.define({
    name: 'receivable_collection_delete',
    title: 'Delete receivable collection',
    kind: 'delete',
    entity: 'receivable_collection',
    permission: 'receivable:update',
    description:
      'Borra un cobro que registró el agente (DELETE /receivables/collections/:id), en dos pasos; el saldo se recalcula.',
    input: { id: idArg('Id del cobro.') },
    targetId: (a) => a.id,
    load: (ctx, id) => loadCollection(s, ctx, id),
    handler: (ctx, args) => s.receivables.removeCollection(ctx, args.id),
  });

  k.define({
    name: 'receivable_delete',
    title: 'Delete receivable',
    kind: 'delete',
    entity: 'receivable',
    permission: 'receivable:delete',
    description:
      'Borra una cuenta por cobrar que creó el agente (DELETE /receivables/:id), en dos pasos. Con cobros se rechaza.',
    input: { id: idArg('Id de la cuenta por cobrar.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.receivables.findOne(ctx, id),
    handler: (ctx, args) => s.receivables.remove(ctx, args.id),
  });
}
