import { BadRequestException } from '@nestjs/common';

/*
 * `PayrollPayment` es el único registro del dinero pagado a empleados. Un gasto
 * con categoría PAYROLL lo contaría dos veces (la categoría suma a
 * `operating_expenses` y el motor de utilidad suma además `payroll_paid`), y
 * registrar la nómina sólo como pago la deja invisible en el desglose de
 * gastos. Por eso ningún gasto nuevo —directo, editado o por plantilla
 * recurrente— puede llevar una categoría de tipo PAYROLL.
 *
 * Vive en un guard compartido y se invoca desde los SERVICIOS, no desde el
 * controlador: `expense_create` por MCP llama al mismo servicio, y un guard de
 * ruta lo dejaría sin cubrir.
 */
export const PAYROLL_CATEGORY_MESSAGE =
  'Payroll cannot be recorded as an expense: PayrollPayment is the only record of money paid to ' +
  'employees. Use POST /payroll (manual payment) and POST /payroll/:id/pay instead.';

export function assertCategoryNotPayroll(
  category: { type: string } | null | undefined,
): void {
  if (category?.type === 'PAYROLL') {
    throw new BadRequestException(PAYROLL_CATEGORY_MESSAGE);
  }
}
