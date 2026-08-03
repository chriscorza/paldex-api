## ADDED Requirements

### Requirement: Plantilla de gasto recurrente

El sistema SHALL exponer CRUD completo sobre `/recurring-expenses`, protegido por los permisos `recurring_expense:<action>`.

Una plantilla SHALL tener `concept`, `amount`, `category_id`, `frequency` (`WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`), `start_date`, `active`, `auto_generate`, `requires_confirmation`, y opcionalmente `account_id`, `end_date` y `notes`.

La configuración de vencimiento SHALL validarse contra la periodicidad, con las mismas reglas que la nómina de MVP 1:

- `WEEKLY` → `due_day_of_week` obligatorio, entero de `1` (lunes) a `7` (domingo).
- `BIWEEKLY` → `due_day_of_month` y `second_due_day_of_month` obligatorios, distintos entre sí.
- `MONTHLY` → `due_day_of_month` obligatorio, entero de `1` a `31`.
- `YEARLY` → `due_day_of_month` obligatorio, más el mes de vencimiento.

Una plantilla es una plantilla: MUST NOT contar en ningún reporte financiero por sí misma.

#### Scenario: Crear una plantilla mensual

- **WHEN** se envía `POST /recurring-expenses` con `{ "concept": "Renta local", "amount": 8000, "category_id": 2, "frequency": "MONTHLY", "due_day_of_month": 5, "start_date": "2026-08-01", "account_id": 1 }`
- **THEN** el sistema responde `201 Created` con la plantilla activa

#### Scenario: Periodicidad sin su configuración

- **WHEN** se envía `"frequency": "MONTHLY"` sin `due_day_of_month`
- **THEN** el sistema responde `400 Bad Request` y no crea nada

#### Scenario: Configuración que no corresponde

- **WHEN** se envía `"frequency": "MONTHLY"` con `due_day_of_month: 5` y además `due_day_of_week: 5`
- **THEN** el sistema responde `400 Bad Request` indicando que `due_day_of_week` no aplica

#### Scenario: La plantilla no cuenta como gasto

- **WHEN** existe una plantilla activa de `8000` y ningún gasto generado
- **THEN** el reporte mensual no incluye esos `8000` en ningún renglón

#### Scenario: Categoría inexistente

- **WHEN** se envía `"category_id": 9999` y esa categoría no existe
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Generación idempotente de gastos pendientes

El sistema SHALL exponer `POST /recurring-expenses/generate`, que recibe `start_date` y `end_date` y, para cada plantilla activa con `auto_generate: true`, calcula las fechas de vencimiento que caen en el rango y crea un `Expense` por cada una que no exista.

El gasto generado SHALL nacer en estado **`PENDING`**, nunca `PAID`, con `is_recurring: true`, `recurring_expense_id` de su plantilla, `scheduled_due_date` de la fecha calculada, `amount` y `category_id` copiados de la plantilla, y `date` igual a `scheduled_due_date`.

La idempotencia SHALL garantizarse con un índice único `(recurring_expense_id, scheduled_due_date)`.

La respuesta MUST informar cuántos gastos se crearon y cuántos se omitieron por existir ya.

La regla de calendario SHALL ser la misma que en nómina: **si el día configurado no existe en el mes, se usa el último día del mes.**

#### Scenario: Generación mensual

- **WHEN** una plantilla de renta de `8000` vence el día 5 y se genera el rango de agosto de 2026
- **THEN** se crea un `Expense` pendiente de `8000` con `scheduled_due_date` el 5 de agosto

#### Scenario: Generación repetida no duplica

- **WHEN** se ejecuta la generación dos veces con el mismo rango
- **THEN** la segunda ejecución crea `0` gastos y reporta los existentes como omitidos

#### Scenario: Día que no existe en el mes

- **WHEN** una plantilla mensual vence el día 31 y se genera abril
- **THEN** el gasto se genera con `scheduled_due_date` el 30 de abril

#### Scenario: Plantilla inactiva o sin auto_generate

- **WHEN** se ejecuta la generación con una plantilla `active: false` y otra con `auto_generate: false`
- **THEN** ninguna de las dos genera gastos

#### Scenario: Plantilla terminada

- **WHEN** una plantilla tiene `end_date` el 15 de agosto y se genera el rango completo de agosto
- **THEN** se generan sólo los vencimientos hasta el 15 de agosto

#### Scenario: Nunca se genera como pagado

- **WHEN** se ejecuta la generación
- **THEN** todos los gastos creados quedan en estado `PENDING` con `paid_at` nulo, y ninguno cuenta en la utilidad real hasta que se confirme el pago

### Requirement: El monto del gasto generado es editable sin tocar la plantilla

Un `Expense` generado desde una plantilla SHALL permitir editar su `amount` mediante `PATCH /expenses/:id` o al marcarlo como pagado con `POST /expenses/:id/pay`.

Editar el monto del gasto generado MUST NOT modificar el `amount` de la plantilla.

Editar el `amount` de la plantilla MUST NOT modificar los gastos ya generados.

#### Scenario: El internet cuesta más este mes

- **WHEN** una plantilla de internet de `700` generó un gasto pendiente y se marca como pagado con `amount: 740`
- **THEN** el gasto queda `PAID` por `740`, y la plantilla sigue en `700`

#### Scenario: Cambio de monto en la plantilla

- **WHEN** la plantilla de renta sube de `8000` a `8500` y ya existían gastos generados de `8000`
- **THEN** los gastos existentes conservan `8000`, y las generaciones futuras usan `8500`

### Requirement: Gasto fijo y gasto variable se distinguen en los reportes

`Expense` SHALL tener `is_recurring`, `recurring_expense_id?` y `scheduled_due_date?`.

`GET /expenses` SHALL aceptar el filtro `is_recurring`.

El desglose de gastos del reporte mensual SHALL separar:

```
fixed_expenses_paid
fixed_expenses_pending
variable_expenses_paid
```

Y MUST exponer el total de gastos fijos pendientes del periodo, para la alerta correspondiente.

#### Scenario: Filtrar gastos fijos

- **WHEN** se pide `GET /expenses?is_recurring=true&start_date=2026-08-01&end_date=2026-08-31`
- **THEN** la respuesta contiene sólo los gastos generados desde plantillas en ese rango

#### Scenario: Desglose de fijos y variables

- **WHEN** el mes tiene `8000` de renta pagada, `700` de internet pendiente y `3000` de compras varias pagadas
- **THEN** el reporte devuelve `fixed_expenses_paid: 8000`, `fixed_expenses_pending: 700` y `variable_expenses_paid: 3000`

#### Scenario: Alerta de fijos pendientes

- **WHEN** el mes tiene dos gastos fijos pendientes por `700` y `2500`
- **THEN** el reporte expone `fixed_expenses_pending: 3200`, disponible para mostrar la alerta

### Requirement: Borrado y desactivación de plantillas

Desactivar una plantilla SHALL hacerse con `PATCH /recurring-expenses/:id` estableciendo `active: false`, y MUST NOT afectar a los gastos ya generados.

`DELETE /recurring-expenses/:id` MUST responder `409 Conflict` cuando existan gastos generados desde esa plantilla, indicando cuántos, con la desactivación como alternativa.

#### Scenario: Desactivar una plantilla con historial

- **WHEN** se desactiva una plantilla con 12 gastos generados
- **THEN** el sistema responde `200 OK`, los gastos permanecen intactos, y no se generan nuevos

#### Scenario: Borrar una plantilla con historial

- **WHEN** se envía `DELETE /recurring-expenses/:id` de una plantilla con gastos generados
- **THEN** el sistema responde `409 Conflict` y no borra nada

#### Scenario: Borrar una plantilla sin historial

- **WHEN** se envía `DELETE /recurring-expenses/:id` de una plantilla recién creada sin gastos generados
- **THEN** el sistema responde `200 OK` y la plantilla desaparece
