## ADDED Requirements

### Requirement: Cuentas por pagar

El sistema SHALL exponer CRUD completo sobre `/payables`, protegido por los permisos `payable:<action>`.

Un `Payable` SHALL tener `vendor`, `concept`, `total_amount`, `due_date`, y opcionalmente `account_id` y `notes`.

`paid_amount` y `status` MUST ser derivados y de sólo lectura: el cliente MUST NOT poder enviarlos.

#### Scenario: Crear una cuenta por pagar

- **WHEN** se envía `POST /payables` con `{ "vendor": "Distribuidora TCG", "concept": "Pedido sellado agosto", "total_amount": 10000, "due_date": "2026-09-15" }`
- **THEN** el sistema responde `201 Created` con `paid_amount: 0` y `status: PENDING`

#### Scenario: paid_amount enviado por el cliente

- **WHEN** se envía `POST /payables` con un body válido más `"paid_amount": 4000`
- **THEN** el sistema responde `400 Bad Request` por campo no reconocido

#### Scenario: Monto total no positivo

- **WHEN** se envía `"total_amount": 0` o un valor negativo
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Abonos y estado derivado del saldo

El sistema SHALL exponer `POST /payables/:id/payments`, que registra un abono con `amount`, `paid_at`, `account_id` y `notes` opcional.

Tras cada abono, el sistema SHALL recalcular en la misma transacción:

```
paid_amount = suma de los abonos
status      = PENDING  si paid_amount es 0
            = PARTIAL  si 0 < paid_amount < total_amount
            = PAID     si paid_amount = total_amount
```

Un abono que exceda el saldo pendiente MUST responder `400 Bad Request` indicando el saldo disponible, y MUST NOT registrarse.

`GET /payables/:id` MUST incluir `remaining_amount = total_amount - paid_amount` y la lista de abonos.

#### Scenario: Abono parcial

- **WHEN** se abona `4000` a un `Payable` de `10000`
- **THEN** queda con `paid_amount: 4000`, `remaining_amount: 6000` y `status: PARTIAL`

#### Scenario: Abono que liquida

- **WHEN** se abona `6000` a ese mismo `Payable`
- **THEN** queda con `paid_amount: 10000`, `remaining_amount: 0` y `status: PAID`

#### Scenario: Abono que excede el saldo

- **WHEN** se abona `7000` a un `Payable` de `10000` con `4000` ya abonados
- **THEN** el sistema responde `400 Bad Request` indicando que el saldo pendiente es `6000`, y no registra el abono

#### Scenario: Abono a una cuenta inactiva

- **WHEN** se registra un abono con `account_id` de una cuenta inactiva
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Borrar un abono

- **WHEN** se borra un abono de `4000` de un `Payable` de `10000` que estaba `PARTIAL`
- **THEN** el `Payable` vuelve a `paid_amount: 0` y `status: PENDING`

### Requirement: El vencimiento se deriva, no se captura

El estado `OVERDUE` SHALL derivarse en tiempo de consulta comparando `due_date` con la fecha actual: un `Payable` con `status` `PENDING` o `PARTIAL` y `due_date` anterior a hoy MUST reportarse como vencido.

El sistema MUST NOT persistir `OVERDUE` como valor almacenado, para que nunca quede obsoleto.

#### Scenario: Cuenta vencida

- **WHEN** un `Payable` `PARTIAL` tiene `due_date` del 15 de agosto y hoy es 20 de agosto
- **THEN** la respuesta lo reporta como vencido, con los días de atraso

#### Scenario: Cuenta liquidada tras su vencimiento

- **WHEN** un `Payable` con `due_date` pasada se liquida completamente
- **THEN** su estado es `PAID` y no se reporta como vencido

#### Scenario: Filtrar vencidas

- **WHEN** se pide `GET /payables?overdue=true`
- **THEN** la respuesta contiene sólo las cuentas pendientes o parciales con vencimiento anterior a hoy

### Requirement: Cancelación en vez de borrado cuando hay abonos

Un `Payable` con abonos registrados MUST NOT poder borrarse: `DELETE /payables/:id` MUST responder `409 Conflict` con la cancelación como alternativa.

`PATCH /payables/:id` con `status: CANCELLED` SHALL permitirse; una cuenta cancelada MUST NOT contar en el dinero comprometido.

#### Scenario: Borrar con abonos

- **WHEN** se envía `DELETE /payables/:id` de una cuenta con dos abonos
- **THEN** el sistema responde `409 Conflict` y no borra nada

#### Scenario: Cancelar una cuenta

- **WHEN** se cancela un `Payable` pendiente de `10000`
- **THEN** su estado es `CANCELLED` y el reporte de caja deja de restar esos `10000`

### Requirement: Cuentas por cobrar

El sistema SHALL exponer CRUD completo sobre `/receivables`, protegido por los permisos `receivable:<action>`, simétrico a las cuentas por pagar.

Un `Receivable` SHALL tener `customer`, `concept`, `total_amount`, `due_date`, y opcionalmente `related_income_id` y `notes`. `collected_amount` y `status` (`PENDING`, `PARTIAL`, `COLLECTED`, `CANCELLED`) MUST ser derivados.

`POST /receivables/:id/collections` SHALL registrar cobros con las mismas reglas: no exceder el saldo, estado derivado, vencimiento calculado.

Un `Receivable` MUST NOT contar como ingreso por sí mismo: el ingreso se registra cuando el dinero entra, vía `Income`.

#### Scenario: Cobro parcial

- **WHEN** se cobra `3000` de un `Receivable` de `5000`
- **THEN** queda con `collected_amount: 3000`, `remaining_amount: 2000` y `status: PARTIAL`

#### Scenario: La cuenta por cobrar no es ingreso

- **WHEN** existe un `Receivable` pendiente de `5000` y ningún `Income` asociado
- **THEN** el reporte mensual no incluye esos `5000` en `gross_sales` ni en ningún renglón de ingreso

#### Scenario: Cobro que excede el saldo

- **WHEN** se cobra `3000` de un `Receivable` de `5000` con `3000` ya cobrados
- **THEN** el sistema responde `400 Bad Request` indicando el saldo pendiente

### Requirement: El dinero disponible resta lo comprometido

`GET /reports/cash` SHALL restar del dinero disponible las cuentas por pagar no liquidadas ni canceladas:

```
available_cash = total_computed_balance
               - pending_payroll
               - pending_taxes
               - payables_outstanding
```

La respuesta SHALL desglosar `payables_outstanding` en `payables_overdue` y `payables_upcoming`, y SHALL incluir `receivables_outstanding` como cifra informativa **que no se suma** al disponible — un cobro esperado no es dinero en la cuenta.

`excluded_liabilities` MUST quedar vacío: ya no hay pasivos conocidos fuera del cálculo.

#### Scenario: Disponible con cuentas por pagar

- **WHEN** el saldo calculado es `50000`, hay `8000` de nómina pendiente y `30000` de cuentas por pagar no liquidadas
- **THEN** `available_cash` es `12000` y `excluded_liabilities` es una lista vacía

#### Scenario: Desglose de vencidas y por vencer

- **WHEN** de esos `30000`, `12000` están vencidos y `18000` vencen después de hoy
- **THEN** la respuesta devuelve `payables_overdue: 12000` y `payables_upcoming: 18000`

#### Scenario: Las cuentas por cobrar no suman al disponible

- **WHEN** existen `15000` en cuentas por cobrar pendientes
- **THEN** `receivables_outstanding` es `15000` y `available_cash` no los incluye

#### Scenario: Cuentas canceladas excluidas

- **WHEN** una cuenta por pagar de `10000` se cancela
- **THEN** `payables_outstanding` deja de incluirla y `available_cash` sube `10000`

### Requirement: Próximos pagos importantes

El sistema SHALL exponer `GET /reports/upcoming-payments?days=30`, que devuelve, ordenados por fecha de vencimiento ascendente y unificados en una sola lista: cuentas por pagar no liquidadas, gastos pendientes, pagos de nómina pendientes y pagos de impuestos pendientes.

Cada elemento SHALL declarar su tipo, concepto, monto pendiente, fecha de vencimiento y si está vencido.

#### Scenario: Lista unificada de próximos pagos

- **WHEN** se pide `GET /reports/upcoming-payments?days=30` con una cuenta por pagar el día 15, nómina el día 7 y un gasto fijo el día 5
- **THEN** la respuesta lista los tres en orden 5, 7, 15, cada uno con su tipo declarado

#### Scenario: Vencidos primero

- **WHEN** existe una cuenta por pagar vencida hace 10 días
- **THEN** aparece al principio de la lista, marcada como vencida con sus días de atraso
