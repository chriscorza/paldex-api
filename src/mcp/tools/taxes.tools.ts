import { McpToolkit } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { DATE_RULE, WRITE_RULE, idArg } from './shared';
import {
  CreateTaxPaymentDto,
  FilterTaxPaymentsDto,
  PayTaxPaymentDto,
  TaxEstimateQueryDto,
  UpdateTaxPaymentDto,
} from '../../tax-payments/dto/tax-payment.dto';
import { CreateTaxDto } from '../../taxes/dto/create-tax.dto';
import { UpdateTaxDto } from '../../taxes/dto/update-tax.dto';
import { FilterTaxesDto } from '../../taxes/dto/filter-taxes.dto';

/*
 * Pagos de impuestos (IVA, ISR, impuestos de nómina) y catálogo de tasas.
 * Antes estaban en la lista negra por precaución; con validación igual a REST,
 * bitácora y atribución al dueño reciben el mismo trato que la nómina
 * (expand-mcp-agent). TaxPayment sigue siendo la única fuente de los impuestos
 * pagados: pagar un impuesto nunca crea un gasto.
 */
export function defineTaxTools(k: McpToolkit, s: McpServices) {
  k.define({
    name: 'tax_payments_list',
    title: 'List tax payments',
    kind: 'read',
    permission: 'tax_payment:read',
    description:
      'Pagos de impuestos (IVA, ISR, nómina) pendientes y pagados, como GET /tax-payments.',
    input: dtoToZodShape(FilterTaxPaymentsDto),
    dto: FilterTaxPaymentsDto,
    handler: (ctx, _args, dto) => s.taxPayments.findAll(ctx, dto),
  });

  k.define({
    name: 'tax_payment_estimate',
    title: 'Estimate taxes for a period',
    kind: 'read',
    permission: 'tax_payment:read',
    description:
      'Estimación de IVA (y de ISR si está configurado) de un periodo, como GET /tax-payments/estimate. Es una estimación, no un cálculo fiscal.',
    input: dtoToZodShape(TaxEstimateQueryDto),
    dto: TaxEstimateQueryDto,
    handler: (ctx, _args, dto) => s.taxPayments.estimate(ctx, dto),
  });

  k.define({
    name: 'tax_payment_create',
    title: 'Create tax payment',
    kind: 'create',
    entity: 'tax_payment',
    permission: 'tax_payment:create',
    description:
      'Registra un impuesto por pagar o ya pagado (POST /tax-payments): IVA, ISR, PAYROLL_TAX (IMSS, ISN, retenciones) u OTHER. ' +
      'Nunca lo registres como gasto. ' +
      WRITE_RULE +
      ' ' +
      DATE_RULE,
    input: dtoToZodShape(CreateTaxPaymentDto),
    dto: CreateTaxPaymentDto,
    load: (ctx, id) => s.taxPayments.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.taxPayments.create(ctx, dto),
    dateOf: (e) => e?.paid_at,
  });

  k.define({
    name: 'tax_payment_update',
    title: 'Update tax payment',
    kind: 'update',
    entity: 'tax_payment',
    permission: 'tax_payment:update',
    description:
      'Corrige un pago de impuesto (PATCH /tax-payments/:id); manda sólo lo que cambia.',
    input: {
      id: idArg('Id del pago de impuesto.'),
      ...dtoToZodShape(UpdateTaxPaymentDto, { partial: true }),
    },
    dto: UpdateTaxPaymentDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.taxPayments.findOne(ctx, id),
    handler: (ctx, args, dto) => s.taxPayments.update(ctx, args.id, dto),
    dateOf: (e) => e?.paid_at,
  });

  k.define({
    name: 'tax_payment_pay',
    title: 'Mark tax payment as paid',
    kind: 'action',
    action: 'pay',
    entity: 'tax_payment',
    permission: 'tax_payment:update',
    description:
      'Marca como pagado un impuesto pendiente (POST /tax-payments/:id/pay). Fecha y cuenta las sabe el usuario: no las supongas.',
    input: {
      id: idArg('Id del pago de impuesto.'),
      ...dtoToZodShape(PayTaxPaymentDto),
    },
    dto: PayTaxPaymentDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.taxPayments.findOne(ctx, id),
    handler: (ctx, args, dto) => s.taxPayments.pay(ctx, args.id, dto),
    dateOf: (e) => e?.paid_at,
  });

  k.define({
    name: 'tax_payment_delete',
    title: 'Delete tax payment',
    kind: 'delete',
    entity: 'tax_payment',
    permission: 'tax_payment:delete',
    description:
      'Borra un pago de impuesto que registró el agente (DELETE /tax-payments/:id), en dos pasos.',
    input: { id: idArg('Id del pago de impuesto.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.taxPayments.findOne(ctx, id),
    handler: (ctx, args) => s.taxPayments.remove(ctx, args.id),
  });

  /* ---- Catálogo de tasas (IVA 16 %, retenciones…) ---- */
  k.define({
    name: 'taxes_list',
    title: 'List tax rates',
    kind: 'read',
    permission: 'tax:read',
    description:
      'Catálogo de impuestos y tasas que se pueden aplicar a gastos e ingresos (GET /taxes).',
    input: dtoToZodShape(FilterTaxesDto),
    dto: FilterTaxesDto,
    handler: (_ctx, _args, dto) => s.taxes.findAll(dto),
  });

  k.define({
    name: 'tax_create',
    title: 'Create tax rate',
    kind: 'create',
    entity: 'tax',
    permission: 'tax:create',
    description:
      'Agrega un impuesto al catálogo (POST /taxes). Ojo: el catálogo es compartido por todas las cuentas de esta instalación.',
    input: dtoToZodShape(CreateTaxDto),
    dto: CreateTaxDto,
    load: (_ctx, id) => s.taxes.findOne(id),
    handler: (_ctx, _args, dto) => s.taxes.create(dto),
  });

  k.define({
    name: 'tax_update',
    title: 'Update tax rate',
    kind: 'update',
    entity: 'tax',
    permission: 'tax:update',
    description:
      'Cambia un impuesto del catálogo (PATCH /taxes/:id). Afecta a todas las cuentas de esta instalación.',
    input: {
      id: idArg('Id del impuesto.'),
      ...dtoToZodShape(UpdateTaxDto, { partial: true }),
    },
    dto: UpdateTaxDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (_ctx, id) => s.taxes.findOne(id),
    handler: (_ctx, args, dto) => s.taxes.update(args.id, dto),
  });

  k.define({
    name: 'tax_delete',
    title: 'Delete tax rate',
    kind: 'delete',
    entity: 'tax',
    permission: 'tax:delete',
    description:
      'Borra un impuesto del catálogo que creó el agente (DELETE /taxes/:id), en dos pasos.',
    input: { id: idArg('Id del impuesto.') },
    targetId: (a) => a.id,
    load: (_ctx, id) => s.taxes.findOne(id),
    handler: (_ctx, args) => s.taxes.remove(args.id),
  });
}
