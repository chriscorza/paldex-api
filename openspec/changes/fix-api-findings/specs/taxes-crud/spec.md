## ADDED Requirements

### Requirement: Cancelar un tax payment pagado

El sistema SHALL aceptar `status: "CANCELLED"` en `PATCH /tax-payments/:id` cuando el tax payment está en estado `PAID`. La transición de `PAID` a `CANCELLED` MUST ser la única transición de status permitida vía PATCH. Cualquier otro valor de `status` MUST ser rechazado con `400 Bad Request`.

#### Scenario: Cancelar un tax payment PAID

- **WHEN** se envía `PATCH /tax-payments/1` con `{ "status": "CANCELLED" }` y el tax payment 1 tiene status `PAID`
- **THEN** el sistema responde `200 OK` y el tax payment cambia a status `CANCELLED`

#### Scenario: No se puede cancelar un tax payment PENDING

- **WHEN** se envía `PATCH /tax-payments/1` con `{ "status": "CANCELLED" }` y el tax payment 1 tiene status `PENDING`
- **THEN** el sistema responde `400 Bad Request` con un mensaje indicando que solo se puede cancelar un pago en estado PAID

#### Scenario: No se puede cambiar status a PAID vía PATCH

- **WHEN** se envía `PATCH /tax-payments/1` con `{ "status": "PAID" }` y el tax payment existe
- **THEN** el sistema responde `400 Bad Request` (solo se acepta `CANCELLED`)

#### Scenario: Tax payment no encontrado

- **WHEN** se envía `PATCH /tax-payments/9999` con `{ "status": "CANCELLED" }` y ese tax payment no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Cancelar no modifica otros campos

- **WHEN** se envía `PATCH /tax-payments/1` con `{ "status": "CANCELLED" }` y el tax payment tiene `amount: 5000`
- **THEN** el tax payment se cancela y su `amount` sigue siendo `5000`
