## ADDED Requirements

### Requirement: Generación idempotente de pagos programados

El sistema SHALL exponer `POST /payroll/generate`, que recibe un rango de fechas (`start_date`, `end_date`) y, para cada empleado activo, calcula las fechas de pago que caen en ese rango según su periodicidad y crea un `PayrollPayment` en estado `PENDING` por cada una que no exista todavía.

La idempotencia SHALL garantizarse con un índice único sobre `(employee_id, scheduled_pay_date, period_start, period_end)`.

Cada pago generado MUST llevar `auto_generated: true`, `pay_frequency_snapshot` con la periodicidad vigente del empleado, `gross_amount` igual al salario base configurado para ese periodo, `bonuses: 0`, `deductions: 0` y `net_amount = gross_amount + bonuses - deductions`.

La respuesta MUST informar cuántos pagos se crearon y cuántos se omitieron por existir ya.

#### Scenario: Generación repetida no duplica

- **WHEN** se ejecuta `POST /payroll/generate` dos veces con el mismo rango
- **THEN** la segunda ejecución crea `0` pagos y reporta los existentes como omitidos

#### Scenario: Generación semanal de un mes con cinco viernes

- **WHEN** un empleado cobra semanal los viernes por `2000` y se genera el rango del 1 al 31 de agosto de 2026, mes con cinco viernes
- **THEN** se crean 5 pagos pendientes de `2000` cada uno, con fechas programadas en cada viernes de agosto

#### Scenario: Empleado inactivo no genera

- **WHEN** se ejecuta la generación con un empleado `active: false`
- **THEN** no se crea ningún pago para ese empleado

#### Scenario: Pago editado manualmente no se sobreescribe

- **WHEN** un pago generado se edita con `bonuses: 500` y luego se vuelve a ejecutar la generación del mismo rango
- **THEN** el pago conserva `bonuses: 500` y no se regenera

### Requirement: Cálculo de fechas de pago por periodicidad

El cálculo de fechas SHALL implementarse como una función pura, sin acceso a base de datos, y SHALL cumplir:

- `WEEKLY`: una fecha por cada día de la semana configurado que cae en el rango. El periodo cubierto es el intervalo de siete días que termina en la fecha de pago.
- `BIWEEKLY`: dos fechas por mes, en `biweekly_first_day` y `biweekly_second_day`. Si el día configurado no existe en ese mes, SHALL usarse el último día del mes.
- `MONTHLY`: una fecha por mes, en `monthly_pay_day`. Si el día no existe en ese mes, SHALL usarse el último día del mes.

Una fecha de pago SHALL pertenecer al mes calendario en el que cae, sin importar qué periodo cubre.

#### Scenario: Día 30 en febrero

- **WHEN** un empleado quincenal cobra los días 15 y 30, y se genera febrero de 2027 (28 días)
- **THEN** se crean dos pagos: uno el 15 de febrero y otro el 28 de febrero

#### Scenario: Día 31 en un mes de 30 días

- **WHEN** un empleado mensual cobra el día 31 y se genera abril
- **THEN** se crea un pago el 30 de abril

#### Scenario: Pago semanal a caballo entre dos meses

- **WHEN** un empleado semanal cobra los lunes y el lunes cae el 3 de agosto cubriendo del 28 de julio al 3 de agosto
- **THEN** el pago pertenece a agosto, y el reporte de agosto lo cuenta, indicando que su periodo cubierto empieza en julio

### Requirement: El bono mensual se captura a mano, nunca se calcula

El sistema MUST NOT calcular ni asignar automáticamente ningún monto de bono. Los pagos generados nacen con `bonuses: 0`.

El campo `bonuses` SHALL poder editarse mediante `PATCH /payroll/:id` mientras el pago no esté en estado `PAID`. Al cambiar `bonuses` o `deductions`, `net_amount` MUST recalcularse en el servidor.

El sistema SHALL permitir además registrar un pago de bono independiente creando un `PayrollPayment` manual con `gross_amount: 0` y el bono en `bonuses`.

#### Scenario: Editar el bono de un pago pendiente

- **WHEN** se envía `PATCH /payroll/7` con `{ "bonuses": 1500 }` sobre un pago `PENDING` de `gross_amount: 2000`
- **THEN** el pago queda con `bonuses: 1500` y `net_amount: 3500`

#### Scenario: Editar el bono de un pago ya pagado

- **WHEN** se envía `PATCH /payroll/7` con `{ "bonuses": 1500 }` sobre un pago en estado `PAID`
- **THEN** el sistema responde `409 Conflict` indicando que un pago pagado no se edita, y no modifica nada

#### Scenario: Bono como pago separado

- **WHEN** se envía `POST /payroll` con `{ "employee_id": 3, "period_start": "2026-08-01", "period_end": "2026-08-31", "scheduled_pay_date": "2026-08-31", "gross_amount": 0, "bonuses": 3000 }`
- **THEN** el sistema responde `201 Created` con `net_amount: 3000`, `auto_generated: false`

#### Scenario: net_amount enviado por el cliente

- **WHEN** se envía `POST /payroll` con un body válido más `"net_amount": 1`
- **THEN** el sistema responde `400 Bad Request` por campo no reconocido

### Requirement: Marcar un pago como pagado

El sistema SHALL exponer `POST /payroll/:id/pay`, que recibe `paid_at`, `account_id` y opcionalmente un `net_amount` final, y transiciona el pago a estado `PAID`.

`account_id` MUST existir y pertenecer al usuario. Si no se envía, MUST usarse `default_payment_account_id` del empleado; si tampoco existe, el sistema MUST responder `400 Bad Request`.

Un pago en estado `PAID` o `CANCELLED` MUST NOT poder pagarse de nuevo.

#### Scenario: Pago correcto

- **WHEN** se envía `POST /payroll/7/pay` con `{ "paid_at": "2026-08-07", "account_id": 2 }`
- **THEN** el pago queda en estado `PAID` con su `paid_at` y su cuenta, y cuenta como egreso de nómina de agosto

#### Scenario: Pago sin cuenta ni cuenta por defecto

- **WHEN** se envía `POST /payroll/7/pay` sin `account_id` y el empleado no tiene `default_payment_account_id`
- **THEN** el sistema responde `400 Bad Request` y el pago sigue `PENDING`

#### Scenario: Doble pago

- **WHEN** se envía `POST /payroll/7/pay` sobre un pago que ya está `PAID`
- **THEN** el sistema responde `409 Conflict` y no altera el pago

#### Scenario: Monto final distinto al programado

- **WHEN** se envía `POST /payroll/7/pay` con `{ "paid_at": "2026-08-07", "account_id": 2, "net_amount": 1800 }` sobre un pago programado de `2000`
- **THEN** el pago queda `PAID` con `net_amount: 1800`, y el reporte cuenta `1800` como nómina pagada

### Requirement: Estados de un pago de nómina

Un `PayrollPayment` SHALL estar en uno de los estados `SCHEDULED`, `PENDING`, `PAID`, `CANCELLED`, `SKIPPED`.

Las transiciones permitidas SHALL ser: `SCHEDULED → PENDING`, `SCHEDULED → CANCELLED`, `PENDING → PAID`, `PENDING → SKIPPED`, `PENDING → CANCELLED`. Cualquier otra MUST responder `409 Conflict`.

Sólo un pago en estado `PAID` MUST contar como nómina pagada. `PENDING` y `SCHEDULED` cuentan como nómina pendiente. `CANCELLED` y `SKIPPED` MUST NOT contar en ninguna de las dos.

#### Scenario: Omitir un pago

- **WHEN** se envía `PATCH /payroll/7` con `{ "status": "SKIPPED" }` sobre un pago `PENDING`
- **THEN** el pago queda `SKIPPED` y desaparece tanto de nómina pagada como de nómina pendiente

#### Scenario: Transición inválida

- **WHEN** se intenta pasar un pago `PAID` a `PENDING`
- **THEN** el sistema responde `409 Conflict`

### Requirement: La nómina no genera filas de gasto

El sistema MUST NOT crear ningún `Expense` a partir de un `PayrollPayment`.

`PayrollPayment` SHALL ser la única fuente de verdad de la nómina, y el motor de reportes SHALL proyectarla directamente al renglón `payroll`. Esto evita contar dos veces el mismo pago.

#### Scenario: Pagar nómina no crea gasto

- **WHEN** se marca un pago de nómina como `PAID` por `2000`
- **THEN** no aparece ningún `Expense` nuevo, y el reporte del mes muestra `payroll_paid: 2000` y no altera `operating_expenses`

#### Scenario: Un gasto de tipo PAYROLL capturado a mano sí cuenta

- **WHEN** existe un `Expense` pagado de categoría de tipo `PAYROLL` por `500` además de `2000` de nómina pagada
- **THEN** el reporte muestra `payroll_total: 2500`, desglosado entre nómina del módulo y gastos de tipo `PAYROLL`

### Requirement: Asignación de un pago a un mes

Para la utilidad real, un pago SHALL contarse en el mes de su `paid_at`.

Para pendientes y proyección, un pago SHALL contarse en el mes de su `scheduled_pay_date`.

Cuando un pago se paga en un mes distinto al que estaba programado, el reporte del mes de pago MUST indicar que corresponde a un periodo anterior.

#### Scenario: Pago programado en julio y pagado en agosto

- **WHEN** un pago con `scheduled_pay_date` del 31 de julio se paga el 3 de agosto
- **THEN** el reporte de julio lo muestra como nómina pendiente de julio, el reporte de agosto lo cuenta como nómina pagada de agosto, y lo marca como pago diferido de julio

### Requirement: Listar y filtrar pagos de nómina

El sistema SHALL exponer `GET /payroll`, protegido por `payroll:read`, con filtros `employee_id`, `status`, rango de fechas sobre `scheduled_pay_date` o sobre `paid_at` (seleccionable con `date_field`), `sort_by`, `order`, `page` y `limit`.

#### Scenario: Filtrar pagos pendientes del mes

- **WHEN** se pide `GET /payroll?status=PENDING&date_field=scheduled_pay_date&start_date=2026-08-01&end_date=2026-08-31`
- **THEN** la respuesta contiene sólo los pagos pendientes programados en agosto de 2026

#### Scenario: Filtrar por fecha real de pago

- **WHEN** se pide `GET /payroll?date_field=paid_at&start_date=2026-08-01&end_date=2026-08-31`
- **THEN** la respuesta contiene los pagos efectivamente pagados en agosto, sin importar cuándo estaban programados

### Requirement: Borrado de pagos de nómina

`DELETE /payroll/:id` SHALL borrar únicamente pagos que no estén en estado `PAID`. Un pago `PAID` MUST responder `409 Conflict`, con la cancelación como alternativa.

#### Scenario: Borrar un pago pagado

- **WHEN** se envía `DELETE /payroll/7` sobre un pago `PAID`
- **THEN** el sistema responde `409 Conflict` y no borra nada
