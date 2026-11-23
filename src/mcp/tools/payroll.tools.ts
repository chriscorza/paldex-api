import { z } from 'zod';
import { PayrollStatus } from '@prisma/client';
import { McpToolkit } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { WRITE_RULE, idArg, isoDate, pageInput } from './shared';
import {
  CreatePayrollPaymentDto,
  FilterPayrollDto,
  GeneratePayrollDto,
  PayPayrollDto,
  UpdatePayrollPaymentDto,
} from '../../payroll/dto/payroll.dto';
import {
  CreateEmployeeDto,
  FilterEmployeesDto,
  UpdateEmployeeDto,
} from '../../employees/dto/create-employee.dto';

/*
 * PayrollPayment es el único registro del dinero pagado a empleados: la nómina
 * nunca es gasto. Los impuestos de nómina van por tax_payment_* (PAYROLL_TAX).
 */
export function definePayrollTools(k: McpToolkit, s: McpServices) {
  k.define({
    name: 'payroll_list',
    title: 'List payroll payments',
    kind: 'read',
    permission: 'payroll:read',
    description:
      'Pagos de nómina (pagados o por pagar) con los filtros y el sobre paginado de GET /payroll. Las dos fechas son obligatorias: ' +
      'filtran sobre date_field (scheduled_pay_date por omisión, o paid_at). Usa status=PENDING para ver periodos sin pagar.',
    input: {
      start_date: isoDate('Primer día, incluido. YYYY-MM-DD.'),
      end_date: isoDate('Último día, incluido. YYYY-MM-DD.'),
      employee_id: z.number().int().optional(),
      status: z.nativeEnum(PayrollStatus).optional(),
      date_field: z
        .enum(['scheduled_pay_date', 'paid_at'])
        .optional()
        .describe('A qué fecha aplican start_date y end_date.'),
      ...pageInput,
    },
    dto: FilterPayrollDto,
    handler: (ctx, _args, dto) => s.payroll.findAll(ctx, dto),
  });

  k.define({
    name: 'payroll_generate',
    title: 'Generate payroll for a period',
    kind: 'action',
    action: 'generate',
    entity: 'payroll_payment',
    permission: 'payroll:create',
    description:
      'Genera los pagos de nómina PENDING de los empleados activos para un rango (POST /payroll/generate), según su frecuencia y sueldo. ' +
      'No duplica lo que ya existe. No uses already_paid salvo que el usuario esté cargando histórico ya pagado. ' +
      'Los pagos generados así no se pueden borrar desde aquí (sí corregir con payroll_update).',
    input: dtoToZodShape(GeneratePayrollDto),
    dto: GeneratePayrollDto,
    handler: (ctx, _args, dto) => s.payroll.generate(ctx, dto),
    resultId: () => undefined,
  });

  k.define({
    name: 'payroll_create',
    title: 'Create manual payroll payment',
    kind: 'create',
    entity: 'payroll_payment',
    permission: 'payroll:create',
    description:
      'Registra un pago de nómina manual (bono, ajuste) como PENDING (POST /payroll). Para marcarlo pagado usa payroll_pay. ' +
      'net = bruto − deducciones + bonos. ' +
      WRITE_RULE,
    input: dtoToZodShape(CreatePayrollPaymentDto),
    dto: CreatePayrollPaymentDto,
    load: (ctx, id) => s.payroll.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.payroll.createManual(ctx, dto),
  });

  k.define({
    name: 'payroll_update',
    title: 'Update payroll payment',
    kind: 'update',
    entity: 'payroll_payment',
    permission: 'payroll:update',
    description:
      'Corrige un pago de nómina pendiente (PATCH /payroll/:id): montos, fechas, notas. Para pagarlo usa payroll_pay.',
    input: {
      id: idArg('Id del pago de nómina.'),
      ...dtoToZodShape(UpdatePayrollPaymentDto, { partial: true }),
    },
    dto: UpdatePayrollPaymentDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.payroll.findOne(ctx, id),
    handler: (ctx, args, dto) => s.payroll.update(ctx, args.id, dto),
  });

  k.define({
    name: 'payroll_pay',
    title: 'Mark payroll payment as paid',
    kind: 'action',
    action: 'pay',
    entity: 'payroll_payment',
    permission: 'payroll:update',
    description:
      'Marca como PAID un pago de nómina (POST /payroll/:id/pay). paid_at y account_id son obligatorios: sólo el usuario sabe cuándo ' +
      'salió el dinero y de qué cuenta. Un pago ya PAID se rechaza.',
    input: {
      payment_id: idArg('Id del pago de nómina.'),
      paid_at: isoDate('Cuándo se pagó. YYYY-MM-DD.'),
      account_id: idArg('Cuenta de la que salió el dinero.'),
    },
    dto: PayPayrollDto,
    idArgs: ['payment_id'],
    targetId: (a) => a.payment_id,
    load: (ctx, id) => s.payroll.findOne(ctx, id),
    handler: (ctx, args, dto) => s.payroll.pay(ctx, args.payment_id, dto),
    dateOf: (e) => e?.paid_at,
  });

  k.define({
    name: 'payroll_delete',
    title: 'Delete payroll payment',
    kind: 'delete',
    entity: 'payroll_payment',
    permission: 'payroll:delete',
    description:
      'Borra un pago de nómina que creó el agente con payroll_create (DELETE /payroll/:id), en dos pasos.',
    input: { id: idArg('Id del pago de nómina.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.payroll.findOne(ctx, id),
    handler: (ctx, args) => s.payroll.remove(ctx, args.id),
  });

  /* ---- Empleados ---- */
  k.define({
    name: 'employees_list',
    title: 'List employees',
    kind: 'read',
    permission: 'employee:read',
    description:
      'Empleados del negocio con sueldo, frecuencia de pago y días de venta asignados (GET /employees).',
    input: dtoToZodShape(FilterEmployeesDto),
    dto: FilterEmployeesDto,
    handler: (ctx, _args, dto) => s.employees.findAll(ctx, dto),
  });

  k.define({
    name: 'employee_create',
    title: 'Create employee',
    kind: 'create',
    entity: 'employee',
    permission: 'employee:create',
    description:
      'Da de alta un empleado (POST /employees). Un día de la semana sólo puede ser de un empleado activo. ' +
      WRITE_RULE,
    input: dtoToZodShape(CreateEmployeeDto),
    dto: CreateEmployeeDto,
    load: (ctx, id) => s.employees.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.employees.create(ctx, dto),
  });

  k.define({
    name: 'employee_update',
    title: 'Update employee',
    kind: 'update',
    entity: 'employee',
    permission: 'employee:update',
    description:
      'Cambia datos de un empleado (PATCH /employees/:id): sueldo, días, frecuencia. Para darlo de baja manda active=false y ended_at.',
    input: {
      id: idArg('Id del empleado.'),
      ...dtoToZodShape(UpdateEmployeeDto, { partial: true }),
    },
    dto: UpdateEmployeeDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.employees.findOne(ctx, id),
    handler: (ctx, args, dto) => s.employees.update(ctx, args.id, dto),
  });

  k.define({
    name: 'employee_delete',
    title: 'Delete employee',
    kind: 'delete',
    entity: 'employee',
    permission: 'employee:delete',
    description:
      'Borra un empleado que creó el agente (DELETE /employees/:id), en dos pasos. Si ya tiene pagos de nómina se rechaza: ' +
      'en ese caso desactívalo con employee_update.',
    input: { id: idArg('Id del empleado.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.employees.findOne(ctx, id),
    handler: (ctx, args) => s.employees.remove(ctx, args.id),
  });
}
