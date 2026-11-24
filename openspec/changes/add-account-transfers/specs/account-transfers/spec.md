# Account Transfers

## Purpose

Registrar el dinero que pasa de una cuenta del negocio a otra (retiros de Mercado Pago al banco,
depósitos de efectivo) para que el saldo calculado de cada cuenta cuadre con la realidad, sin que el
movimiento cuente como ingreso o gasto.

## ADDED Requirements

### Requirement: Registro de traspasos

El sistema SHALL permitir crear, listar, consultar, editar y borrar traspasos (`AccountTransfer`) en
`/account-transfers`. Cada traspaso SHALL guardar cuenta origen, cuenta destino, monto, fecha, nota
opcional, comisión opcional (`fee_amount`, por omisión `0`) y quién lo capturó.

Las rutas SHALL exigir `account_transfer:create`, `account_transfer:read`, `account_transfer:update` o
`account_transfer:delete`, con variante `OWN` que limite a los traspasos del dueño efectivo.

#### Scenario: Alta de un traspaso

- **WHEN** el dueño registra un traspaso de 50,000 de Mercado Pago a BBVA el 2027-01-15
- **THEN** se guarda con `date` igual a la medianoche del 15 de enero en la zona del negocio

#### Scenario: Validaciones

- **WHEN** el origen y el destino son la misma cuenta, el monto es menor o igual a cero, o la comisión es negativa
- **THEN** el API responde `400`

#### Scenario: Cuenta de otro dueño

- **WHEN** el origen o el destino no pertenece al dueño efectivo
- **THEN** el API responde `404` y no crea nada, aunque el alcance del rol sea `ANY`

#### Scenario: Lista filtrada

- **WHEN** se piden los traspasos con `account_id` y un rango de fechas
- **THEN** se devuelven los que tienen esa cuenta como origen o destino dentro del rango, paginados

### Requirement: Un traspaso no es ingreso ni gasto

Un traspaso MUST NOT aparecer en el estado de resultados, en `cash_items` ni en el reporte mensual.

#### Scenario: Estado de resultados sin cambios

- **WHEN** se registra un traspaso sin comisión
- **THEN** el estado de resultados del periodo no cambia

### Requirement: Comisión del traspaso

Si `fee_amount > 0`, el sistema SHALL crear, en la misma transacción, un `Expense` `PAID` por ese monto
desde la cuenta origen, con la fecha del traspaso y la categoría `fee_category_id`, y SHALL ligarlo al
traspaso. `fee_category_id` SHALL ser obligatorio cuando `fee_amount > 0`, visible para el dueño y no de
tipo `PAYROLL`.

#### Scenario: Comisión al crear

- **WHEN** se registra un traspaso de 10,000 con `fee_amount = 35` y una categoría de comisiones
- **THEN** existe un gasto pagado de 35 desde la cuenta origen, y el traspaso guarda su id

#### Scenario: Comisión sin categoría

- **WHEN** `fee_amount = 35` sin `fee_category_id`
- **THEN** el API responde `400`

#### Scenario: Editar o quitar la comisión

- **WHEN** se edita el traspaso cambiando la comisión, la fecha o la cuenta origen
- **THEN** el gasto ligado se actualiza igual
- **WHEN** se edita con `fee_amount = 0`
- **THEN** el gasto ligado se borra

#### Scenario: Borrar el traspaso

- **WHEN** se borra un traspaso con comisión
- **THEN** su gasto ligado también se borra

### Requirement: Cierre mensual

El sistema MUST NOT crear, editar ni borrar un traspaso cuya fecha (anterior o nueva) caiga en un mes
`CLOSED` del dueño, calculado en la zona del negocio; SHALL responder `409`.

#### Scenario: Mes cerrado

- **WHEN** se registra un traspaso con fecha en un mes cerrado
- **THEN** el API responde `409` y no crea nada

### Requirement: Cuentas con traspasos

Una cuenta que es origen o destino de un traspaso MUST NOT poder borrarse.

#### Scenario: Borrar una cuenta con traspasos

- **WHEN** se intenta borrar una cuenta con traspasos
- **THEN** el API responde `409`

### Requirement: Herramientas MCP

El registro MCP SHALL incluir `transfers_list` (lee, `account_transfer:read`), `transfer_create`
(`account_transfer:create`, con `client_ref`), `transfer_update` (`account_transfer:update`) y
`transfer_delete` (`account_transfer:delete`, en dos pasos y sólo para lo que creó el agente), sobre los
mismos servicios que REST.

#### Scenario: Registro del asistente

- **WHEN** el asistente llama `transfer_create` dos veces con el mismo `client_ref`
- **THEN** sólo se crea un traspaso y la segunda respuesta trae `duplicate: true`
