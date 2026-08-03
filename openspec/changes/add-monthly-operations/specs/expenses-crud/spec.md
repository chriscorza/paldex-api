## ADDED Requirements

### Requirement: Vínculo del gasto con su plantilla recurrente

`Expense` SHALL tener `recurring_expense_id?`, `scheduled_due_date?` e `is_recurring`.

Un gasto creado manualmente MUST quedar con `is_recurring: false` y ambos campos opcionales en `null`. Un gasto generado desde una plantilla MUST quedar con `is_recurring: true`, su `recurring_expense_id` y su `scheduled_due_date`.

`recurring_expense_id` y `scheduled_due_date` MUST ser de sólo lectura para el cliente: los asigna la generación. `POST /expenses` con cualquiera de los dos MUST responder `400 Bad Request` por campo no reconocido.

El índice único `(recurring_expense_id, scheduled_due_date)` SHALL garantizar que una plantilla no genere dos veces el mismo vencimiento.

#### Scenario: Gasto manual

- **WHEN** se crea un gasto con `POST /expenses`
- **THEN** queda con `is_recurring: false`, `recurring_expense_id: null` y `scheduled_due_date: null`

#### Scenario: Cliente intenta vincular a una plantilla

- **WHEN** se envía `POST /expenses` con un body válido más `"recurring_expense_id": 3`
- **THEN** el sistema responde `400 Bad Request` y no crea nada

#### Scenario: La respuesta expone el vínculo

- **WHEN** se pide `GET /expenses/:id` de un gasto generado desde una plantilla
- **THEN** la respuesta incluye `is_recurring: true`, su `recurring_expense_id` y su `scheduled_due_date`

### Requirement: Filtro de gasto fijo en el listado

`GET /expenses` SHALL aceptar el filtro `is_recurring`. Sin ese filtro, MUST devolver tanto fijos como variables, preservando el comportamiento actual.

`sort_by` MUST aceptar además `scheduled_due_date`.

#### Scenario: Filtrar sólo gastos fijos

- **WHEN** se pide `GET /expenses?is_recurring=true`
- **THEN** la respuesta contiene sólo gastos generados desde plantillas

#### Scenario: Filtrar sólo gastos variables

- **WHEN** se pide `GET /expenses?is_recurring=false`
- **THEN** la respuesta contiene sólo gastos capturados manualmente

#### Scenario: Ordenar por vencimiento

- **WHEN** se pide `GET /expenses?is_recurring=true&sort_by=scheduled_due_date&order=asc`
- **THEN** la respuesta viene ordenada por fecha de vencimiento ascendente

### Requirement: Las escrituras de expenses respetan el mes cerrado

`POST /expenses`, `PATCH /expenses/:id`, `DELETE /expenses/:id` y `POST /expenses/:id/pay` MUST rechazarse con `409 Conflict` cuando la fecha relevante del gasto caiga dentro de un mes con cierre en estado `CLOSED`.

La fecha relevante SHALL ser `paid_at` cuando exista, y `date` en cualquier otro caso.

El mensaje de error MUST nombrar el periodo cerrado e indicar que hace falta reabrirlo.

Pagar en un mes abierto un gasto cuya `date` cae en un mes cerrado SHALL permitirse: la salida de dinero ocurre en el mes abierto y es ahí donde cuenta.

#### Scenario: Crear un gasto con fecha en un mes cerrado

- **WHEN** se envía `POST /expenses` con `date` en julio y julio está `CLOSED`
- **THEN** el sistema responde `409 Conflict` nombrando julio, y no crea nada

#### Scenario: Editar un gasto pagado en un mes cerrado

- **WHEN** se envía `PATCH /expenses/:id` sobre un gasto con `paid_at` en un mes cerrado
- **THEN** el sistema responde `409 Conflict` y no modifica nada

#### Scenario: Borrar un gasto de un mes cerrado

- **WHEN** se envía `DELETE /expenses/:id` de un gasto pagado en un mes cerrado
- **THEN** el sistema responde `409 Conflict` y no borra nada

#### Scenario: Pagar hoy un gasto viejo

- **WHEN** se envía `POST /expenses/:id/pay` con `paid_at` de hoy sobre un gasto pendiente con `date` en un mes cerrado, estando el mes actual abierto
- **THEN** el sistema acepta el pago y el gasto cuenta en el mes actual

#### Scenario: Escritura en un mes en revisión

- **WHEN** se edita un gasto de un mes en estado `REVIEWING`
- **THEN** el sistema acepta la escritura: sólo `CLOSED` bloquea
