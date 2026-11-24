import { McpToolkit } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { DATE_RULE, WRITE_RULE, idArg } from './shared';
import {
  CreateAccountTransferDto,
  FilterAccountTransfersDto,
  UpdateAccountTransferDto,
} from '../../account-transfers/dto/account-transfer.dto';

/* Traspasos entre cuentas (openspec/changes/add-account-transfers). */
export function defineTransferTools(k: McpToolkit, s: McpServices) {
  k.define({
    name: 'transfers_list',
    title: 'List account transfers',
    kind: 'read',
    permission: 'account_transfer:read',
    description:
      'Traspasos entre cuentas del dueño (GET /account-transfers). Con account_id, los que salen de o llegan a esa cuenta; ' +
      'start_date/end_date en la zona del negocio, último día incluido.',
    input: dtoToZodShape(FilterAccountTransfersDto),
    dto: FilterAccountTransfersDto,
    handler: (ctx, _args, dto) => s.accountTransfers.findAll(ctx, dto),
  });

  k.define({
    name: 'transfer_create',
    title: 'Create account transfer',
    kind: 'create',
    entity: 'account_transfer',
    permission: 'account_transfer:create',
    description:
      'Registra dinero que pasa de una cuenta a otra del negocio (POST /account-transfers): un retiro de Mercado Pago al banco, ' +
      'un depósito de efectivo. NO es ingreso ni gasto: no lo registres con expense_create ni income_create. Si cobraron comisión, ' +
      'pásala en fee_amount con fee_category_id (se registra como gasto pagado desde la cuenta origen). Un mes cerrado se rechaza. ' +
      DATE_RULE +
      ' ' +
      WRITE_RULE,
    input: dtoToZodShape(CreateAccountTransferDto),
    dto: CreateAccountTransferDto,
    load: (ctx, id) => s.accountTransfers.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.accountTransfers.create(ctx, dto),
    dateOf: (e) => e?.date,
  });

  k.define({
    name: 'transfer_update',
    title: 'Update account transfer',
    kind: 'update',
    entity: 'account_transfer',
    permission: 'account_transfer:update',
    description:
      'Corrige un traspaso (PATCH /account-transfers/:id); manda sólo lo que cambia. Actualiza también el gasto de la comisión; ' +
      'fee_amount = 0 lo borra.',
    input: {
      id: idArg('Id del traspaso.'),
      ...dtoToZodShape(UpdateAccountTransferDto, { partial: true }),
    },
    dto: UpdateAccountTransferDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.accountTransfers.findOne(ctx, id),
    handler: (ctx, args, dto) => s.accountTransfers.update(ctx, args.id, dto),
    dateOf: (e) => e?.date,
  });

  k.define({
    name: 'transfer_delete',
    title: 'Delete account transfer',
    kind: 'delete',
    entity: 'account_transfer',
    permission: 'account_transfer:delete',
    description:
      'Borra un traspaso que registró el agente (DELETE /account-transfers/:id), en dos pasos, junto con el gasto de su comisión.',
    input: { id: idArg('Id del traspaso.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.accountTransfers.findOne(ctx, id),
    handler: (ctx, args) => s.accountTransfers.remove(ctx, args.id),
  });
}
