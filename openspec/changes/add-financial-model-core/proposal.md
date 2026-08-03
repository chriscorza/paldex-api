## Why

Hoy la API sabe registrar movimientos: entró dinero, salió dinero. Lo que no sabe es responder la única pregunta que importa para Corszas:

> ¿Cuánto dinero generó realmente este mes, después de costo de mercancía, gastos, nómina e impuestos?

Faltan las piezas que convierten un registro contable en un estado de resultados: **no existen empleados ni nómina**, **el costo de mercancía vendida no está separado del gasto de compra**, **no hay diferencia entre gasto real y gasto fiscalmente deducible**, **no hay pagos de impuestos con periodo fiscal**, y **no hay ningún reporte que encadene ingresos → utilidad bruta → utilidad operativa → utilidad neta**. Sin eso, cada `GET /incomes` y `GET /expenses` es una lista de filas que alguien tiene que sumar a mano en una hoja de cálculo — que es exactamente el trabajo que esta API existe para eliminar.

Además hay un problema silencioso que este change tiene que resolver antes de construir reportes encima: **todos los montos del esquema son `Float`**. Sumar cien filas y multiplicar costos unitarios por cantidades en punto flotante binario produce centavos de deriva; una utilidad neta calculada así no es auditable. Reportes financieros sobre `Float` es construir sobre arena.

## What Changes

### Dinero: precisión antes que nada

- **BREAKING (interno, no de contrato)**: todas las columnas monetarias pasan de `Float` a `Decimal(14,2)` — `Account.balance`, `Account.credit_limit`, `Expense.amount`, `Income.amount`, y las nuevas. La API sigue devolviendo **números JSON**, no strings: una capa de serialización convierte `Decimal → number` en las proyecciones de entidad, así que **el contrato con el frontend no cambia**. `Tax.rate` se queda como `Float` (es una tasa, no dinero).

### Categorías de gasto tipificadas

- Nuevo modelo `ExpenseCategory` de **dos niveles**: un `type` financiero (`COGS`, `OPERATING`, `PAYROLL`, `TAX`, `SHOPIFY_FEES`, `SHIPPING`, `MARKETING`, `DEBT`, `OWNER`, `OTHER`) y un nombre específico dentro de él (`Renta local`, `Meta Ads`, `Comisión Shopify`…).
- El `type` no es decorativo: determina **en qué renglón del estado de resultados cae el gasto**. Tres banderas por categoría lo hacen explícito y auditable en vez de estar cableado en un `switch`: `affects_gross_profit`, `affects_operating_profit`, `is_cash_outflow`.
- Se siembran las **15 categorías mínimas de MVP** como categorías de sistema (`is_system: true`, no borrables); el usuario puede crear las suyas.
- `DEBT` se parte en dos categorías desde el día uno: *intereses* (sí es gasto operativo) y *pago de capital* (no es gasto, es movimiento de caja). `OWNER` (retiros, reinversión, gasto personal) **nunca** reduce utilidad operativa, pero sí reduce caja.

### El gasto gana identidad fiscal y estado de pago

- **Estado de pago**: `Expense` gana `status` (`PENDING`, `PAID`, `SKIPPED`, `CANCELLED`) y `paid_at`. La utilidad real se calcula **base caja**, por `paid_at`; lo pendiente alimenta la proyección del mes. Los gastos existentes se migran a `PAID` con `paid_at = date`.
- **Identidad fiscal**: `invoice_status` (`NOT_INVOICED`, `PENDING_INVOICE`, `INVOICED`, `NOT_DEDUCTIBLE`), `invoice_uuid`, `supplier_rfc`, `vendor`, `subtotal`, `tax_amount`, `withholding_amount`, `is_tax_deductible`, `tax_creditable_amount`.
- Regla dura: **todo gasto pagado reduce caja aunque no esté facturado; sólo un gasto `INVOICED` y deducible aporta IVA acreditable.** Son dos números distintos y el reporte los muestra separados.
- El booleano `invoiced` actual **se conserva y se mantiene sincronizado** (`invoiced === (invoice_status === 'INVOICED')`) para no romper al frontend, pero `invoice_status` pasa a ser la fuente de verdad.

### Costo de mercancía vendida, separado del gasto de compra

- Nuevo modelo `CostOfGoodsSold`: filas de costo (`quantity`, `unit_cost`, `total_cost`, `source`) ligadas a un `Income` concreto.
- **Decisión de negocio central**: el renglón COGS del estado de resultados sale **exclusivamente** de `CostOfGoodsSold` casado contra ventas. Un gasto de categoría `COGS` ("compra de mercancía") es **compra de inventario** — salida de caja y reinversión, no COGS del mes. Mezclarlos duplicaría el costo.
- Como eso puede dejar la utilidad bruta inflada mientras no se capturen costos, el reporte expone siempre `sales_without_cost` y un `cost_data_coverage` — el número dice de frente si es confiable o parcial.

### Empleados y nómina

- Nuevo modelo `Employee`: puesto, activo, `salary_type`, `pay_frequency` (`WEEKLY`, `BIWEEKLY`, `MONTHLY`), salario base, configuración de día de pago según periodicidad, cuenta de pago por defecto, alta y baja.
- Nuevo modelo `PayrollPayment`: periodo, fecha programada, fecha real de pago, bruto, deducciones, **bonos manuales**, neto, cuenta, `status` (`SCHEDULED`, `PENDING`, `PAID`, `CANCELLED`, `SKIPPED`), `auto_generated`.
- **Generación idempotente** de pagos pendientes a partir de la periodicidad del empleado, con llave lógica única `employee_id + scheduled_pay_date + period_start + period_end`. Si el día configurado no existe en el mes (30 de febrero, 31 de abril), cae al último día del mes. Un mes con 5 viernes genera 5 pagos semanales — eso es correcto, refleja la salida real de dinero.
- **El bono nunca se calcula automáticamente.** Se deja el espacio (`bonuses`) editable hasta que el pago se marca `PAID`; el monto lo decide el admin.
- La nómina **no genera filas de `Expense`.** `PayrollPayment` es la única fuente de verdad de nómina; el reporte la proyecta al renglón `PAYROLL` directamente. Cualquier otra opción duplica el gasto.

### Impuestos: obligación del periodo vs salida de caja

- Nuevo modelo `TaxPayment`: `type` (`IVA`, `ISR`, `PAYROLL_TAX`, `OTHER`), `fiscal_period_start`/`fiscal_period_end`, `due_date`, `paid_at`, monto, cuenta, `status`.
- **Dos fechas, dos verdades**: el IVA de julio pagado el 17 de agosto es *obligación de julio* y *salida de caja de agosto*. El reporte muestra ambas cosas sin fingir que son la misma.
- **Estimación simple de IVA** por periodo: `IVA trasladado en ingresos facturados − IVA acreditable en gastos facturados y deducibles`. Si sale negativo, es IVA a favor.
- **ISR estimado** como porcentaje configurable sobre la utilidad antes de impuestos. No se intenta modelar régimen fiscal.
- Igual que la nómina: `TaxPayment` es la única fuente de verdad de pagos de IVA/ISR — no se registran también como `Expense` para no duplicar.

### El reporte mensual real

- `GET /reports/monthly` — el estado de resultados encadenado completo: ingresos brutos → descuentos/comisiones → ingresos netos → COGS → utilidad bruta → gastos operativos + nómina → utilidad operativa → impuestos → **utilidad neta real**, con márgenes bruto y neto.
- `GET /reports/monthly/expenses-breakdown` — gasto por tipo financiero y por categoría, con variación contra el mes anterior y porcentaje sobre ingresos netos y sobre utilidad bruta.
- `GET /reports/monthly/fiscal` — facturado, no facturado, pendiente de factura, IVA acreditable estimado, IVA no acreditable por falta de factura.
- `GET /reports/monthly/payroll` — nómina pagada y pendiente por empleado, salario base vs bonos, y `payroll_ratio`.
- `GET /reports/cash` — saldo por cuenta **calculado desde movimientos** (`initial_balance` + ingresos − egresos pagados), contrastado contra el `balance` capturado a mano, y dinero disponible real = saldos − nómina pendiente − impuestos pendientes.
- Todas las cifras salen del backend. **Ninguna fórmula financiera vive en el frontend.**

### Ingresos y cuentas: campos que el modelo financiero necesita

- `Income` gana `income_type` (`SHOPIFY_ORDER`, `SHOPIFY_REFUND`, `MANUAL_ADJUSTMENT`, `OTHER`), `channel`, y el desglose financiero: `gross_amount`, `discount_total`, `fee_total`, `shipping_charged`, `shipping_cost`, `net_amount`, `cogs_total`, `profit_gross`. `amount` se conserva como el monto neto cobrado.
- **La captura manual de ingresos no se restringe.** `POST /incomes` sigue funcionando igual; `income_type` es opcional y por defecto `OTHER` para lo que se teclee a mano y `SHOPIFY_ORDER`/`SHOPIFY_REFUND` para lo que cree la sincronización. Los ingresos existentes se migran con `net_amount = gross_amount = amount`.
- `Account` gana `currency` (default `MXN`), `is_active` y `initial_balance`.

### No incluido (non-goals)

- **Nada de frontend.** Este change es sólo API.
- **Nada de inventario.** El costo se captura por ingreso/orden, a mano o desde Shopify. No hay existencias, ni valuación, ni promedio ponderado.
- **Gastos recurrentes, cuentas por pagar y cuentas por cobrar**: van en `add-monthly-operations` (MVP 3). Por eso el "dinero disponible" de este change **no** resta cuentas por pagar todavía, y lo dice explícitamente en la respuesta.
- **Cierre mensual, comparación de meses y exportaciones**: también MVP 3. Aquí los reportes son dinámicos: se recalculan siempre, no hay snapshot.
- **Rentabilidad por producto, SKU o categoría de Shopify**: va en `add-shopify-profitability` (MVP 2).
- **Vista devengada** (contar el gasto en el periodo al que corresponde, aunque se pague después). Se elige base caja para la utilidad real y base programada para las alertas; devengado queda para después.
- **No se toca la sincronización de Shopify.** Este change consume lo que `add-shopify-integration` ya produce (`ShopifyOrder`, `Income.source`); no cambia webhooks ni backfill.
- **Sin scheduler.** No se añade `@nestjs/schedule`: la generación de nómina es un endpoint idempotente, invocable a demanda o por un cron externo.

## Capabilities

### New Capabilities
- `money-precision`: representación decimal del dinero en toda la API — columnas `Decimal(14,2)`, serialización a número JSON, y reglas de redondeo para porcentajes y márgenes.
- `expense-categories`: catálogo de categorías de gasto de dos niveles (tipo financiero + categoría), categorías de sistema no borrables, y las banderas que deciden en qué renglón del estado de resultados cae cada gasto.
- `cogs-tracking`: captura del costo de mercancía vendida por ingreso, su agregación a `Income.cogs_total`/`profit_gross`, y la señalización explícita de ventas sin costo capturado.
- `employees`: alta, edición, baja y consulta de empleados, con su configuración de periodicidad y día de pago validada por tipo.
- `payroll`: pagos de nómina — generación idempotente de pagos programados, bono manual editable, marcado de pago real, y las reglas de a qué mes pertenece cada pago.
- `tax-payments`: registro de pagos de impuestos con periodo fiscal separado de la fecha de pago, y estimación simple de IVA e ISR por periodo.
- `financial-reports`: los reportes agregados — estado mensual real, desglose de gastos, reporte fiscal, reporte de nómina y reporte de caja disponible.

### Modified Capabilities
- `expenses-crud`: el gasto gana categoría, proveedor, estado de pago (`status`/`paid_at`) y el bloque de campos fiscales; los filtros aceptan categoría, tipo financiero, estado de pago y estado de factura.
- `incomes-crud`: el ingreso gana `income_type`, `channel` y el desglose financiero bruto/neto/comisiones/COGS/utilidad; los filtros aceptan `income_type` y `channel`.
- `accounts-crud`: la cuenta gana `currency`, `is_active` e `initial_balance`; `is_active` filtra qué cuentas suman al dinero disponible.
- `roles-permissions`: el catálogo de permisos crece con `expense_category`, `cogs`, `employee`, `payroll`, `tax_payment` y `report`, con sus variantes `OWN`/`ANY`.

## Impact

**Base de datos** — una migración con conversión de tipos y backfill, no sólo columnas nuevas:

- Nuevos modelos: `ExpenseCategory`, `CostOfGoodsSold`, `Employee`, `PayrollPayment`, `TaxPayment`.
- Nuevos enums: `ExpenseCategoryType`, `ExpenseStatus`, `InvoiceStatus`, `IncomeType`, `SalaryType`, `PayFrequency`, `PayrollStatus`, `TaxPaymentType`, `TaxPaymentStatus`, `CogsSource`.
- `Expense`: `category_id?`, `vendor?`, `status`, `paid_at?`, `invoice_status`, `invoice_uuid?`, `supplier_rfc?`, `subtotal?`, `tax_amount?`, `withholding_amount?`, `is_tax_deductible`, `tax_creditable_amount?`.
- `Income`: `income_type`, `channel?`, `gross_amount?`, `discount_total?`, `fee_total?`, `shipping_charged?`, `shipping_cost?`, `net_amount?`, `cogs_total?`, `profit_gross?`.
- `Account`: `currency`, `is_active`, `initial_balance`.
- **Conversión `Float → Decimal(14,2)`** en todas las columnas de dinero existentes.
- **Backfill**: gastos existentes → `status = PAID`, `paid_at = date`, `invoice_status` derivado de `invoiced`; ingresos existentes → `net_amount = gross_amount = amount`; cuentas existentes → `initial_balance = balance`, `is_active = true`, `currency = 'MXN'`.
- Índices para reportes: `(paid_at)` y `(category_id)` en `Expense`, `(date)` e `(income_type)` en `Income`, `(scheduled_pay_date)` y `(paid_at)` en `PayrollPayment`, `(paid_at)` y `(fiscal_period_start)` en `TaxPayment`.

**Código nuevo** — siguiendo el patrón módulo-por-recurso del proyecto:
- `src/expense-categories/`, `src/cogs/`, `src/employees/`, `src/payroll/`, `src/tax-payments/`, `src/reports/`.
- `src/common/money.ts` — helpers de decimal, redondeo y serialización.
- `src/reports/profit-engine.service.ts` — el motor de cálculo, puro y testeable sin base de datos.
- `src/payroll/payroll-schedule.ts` — cálculo de fechas de pago por periodicidad, puro y testeable.

**Código modificado**
- `src/expenses/` — DTOs, entidad, servicio y filtros (categoría, estado, campos fiscales).
- `src/incomes/` — DTOs, entidad, servicio y filtros (tipo, canal, desglose).
- `src/accounts/` — DTOs y entidad.
- `src/permissions/permission-catalog.ts` — permisos nuevos.
- `src/app.module.ts` — registrar los módulos nuevos.

**Contrato de API**: aditivo. Los endpoints existentes devuelven campos nuevos; ninguno desaparece ni cambia de tipo (la conversión a `Decimal` se absorbe en la serialización). El frontend no se rompe.

**Dependencias**: ninguna nueva en `package.json`. Usa `@CurrentUser()`, `@RequirePermissions()` y `OwnershipContext` ya existentes. Consume los datos de `add-shopify-integration` pero no depende de que esté terminado — con cero conexiones de Shopify los reportes simplemente cuentan sólo lo capturado a mano.

**Riesgo principal**: la migración `Float → Decimal` toca datos existentes. Exige respaldo previo y verificación de que los montos sobreviven idénticos.
