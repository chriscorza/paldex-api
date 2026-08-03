# Accounts CRUD

## Purpose

Proveer un CRUD completo y autenticado para el recurso `accounts` de la API, con soporte para filtrado, paginación, reglas de negocio del enum `AccountType`, restricción de `credit_limit` y protección de borrado frente a transacciones asociadas.

## Requirements

### Requirement: Autenticación obligatoria en los endpoints de accounts

Todos los endpoints bajo `/accounts` SHALL exigir un JWT válido. El `AccountsController` MUST NOT llevar el decorador `@Public()`.

#### Scenario: Petición sin token

- **WHEN** se hace cualquier petición a `/accounts` sin cabecera `Authorization`
- **THEN** el sistema responde `401 Unauthorized` y no ejecuta ninguna consulta a la base de datos

#### Scenario: Petición con token válido

- **WHEN** se hace una petición a `/accounts` con un JWT firmado con `JWT_SECRET` y no caducado
- **THEN** el sistema procesa la petición normalmente

### Requirement: Crear una cuenta

El sistema SHALL exponer `POST /accounts`, que crea una cuenta a partir de `name`, `balance`, `type` y, según el tipo, `credit_limit`.

`name` MUST ser una cadena no vacía; `balance` MUST ser un número; `type` MUST ser uno de los valores del enum `AccountType` (`CASH`, `CREDIT_CARD`, `DEBIT_CARD`, `OTHER`). Campos no reconocidos en el body MUST ser rechazados.

#### Scenario: Creación correcta de una cuenta de efectivo

- **WHEN** se envía `POST /accounts` con `{ "name": "Efectivo", "balance": 250.0, "type": "CASH" }`
- **THEN** el sistema responde `201 Created` con la cuenta creada, su `id` generado, su `created_at` y `credit_limit` a `null`

#### Scenario: Creación correcta de una tarjeta de crédito

- **WHEN** se envía `POST /accounts` con `{ "name": "Visa", "balance": -300.0, "type": "CREDIT_CARD", "credit_limit": 2000.0 }`
- **THEN** el sistema responde `201 Created` con la cuenta creada y su `credit_limit` a 2000.0

#### Scenario: Tipo de cuenta no válido

- **WHEN** se envía `POST /accounts` con `"type": "CRYPTO"`
- **THEN** el sistema responde `400 Bad Request` indicando los valores admitidos, y no crea ningún registro

#### Scenario: Falta un campo obligatorio

- **WHEN** se envía `POST /accounts` sin `name`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Campo desconocido en el body

- **WHEN** se envía `POST /accounts` con un body válido más `"owner_id": 7`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Tarjeta de crédito sin límite

- **WHEN** se envía `POST /accounts` con `"type": "CREDIT_CARD"` y sin `credit_limit`
- **THEN** el sistema responde `400 Bad Request` indicando que `credit_limit` es obligatorio para las tarjetas de crédito

#### Scenario: Límite de crédito en un tipo que no lo admite

- **WHEN** se envía `POST /accounts` con `"type": "CASH"` y `"credit_limit": 1000`
- **THEN** el sistema responde `400 Bad Request` indicando que `credit_limit` sólo aplica a `CREDIT_CARD`

#### Scenario: Límite de crédito negativo

- **WHEN** se envía `POST /accounts` con `"type": "CREDIT_CARD"` y `"credit_limit": -500`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Consultar una cuenta por id

El sistema SHALL exponer `GET /accounts/:id`, que devuelve una única cuenta junto con el número de incomes y expenses asociados.

#### Scenario: La cuenta existe

- **WHEN** se pide `GET /accounts/1` y la cuenta 1 existe con 3 incomes y 5 expenses
- **THEN** el sistema responde `200 OK` con la cuenta y unos contadores que indican 3 incomes y 5 expenses

#### Scenario: La cuenta no existe

- **WHEN** se pide `GET /accounts/9999` y esa cuenta no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: El id no es numérico

- **WHEN** se pide `GET /accounts/abc`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Listar cuentas con filtros y paginación

El sistema SHALL exponer `GET /accounts`, que devuelve un objeto `{ data, total, page, limit }` donde `data` es la página solicitada y `total` es el número de cuentas que cumplen los filtros, ignorando la paginación.

El endpoint MUST aceptar `search`, `type`, `sort_by`, `order`, `page` y `limit`. Los parámetros ausentes MUST usar sus valores por defecto y no restringir el resultado.

#### Scenario: Listado sin parámetros

- **WHEN** se pide `GET /accounts` sin query params
- **THEN** el sistema responde `200 OK` con la primera página usando `page=1` y `limit=20`, y `total` refleja el total de cuentas

#### Scenario: Búsqueda por nombre

- **WHEN** se pide `GET /accounts?search=visa`
- **THEN** `data` sólo contiene cuentas cuyo `name` contiene la subcadena `visa`, sin distinguir mayúsculas de minúsculas

#### Scenario: Filtro por tipo

- **WHEN** se pide `GET /accounts?type=CREDIT_CARD`
- **THEN** `data` sólo contiene cuentas de tipo `CREDIT_CARD` y `total` cuenta sólo esas

#### Scenario: Filtro por un tipo inexistente

- **WHEN** se pide `GET /accounts?type=CRYPTO`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Ordenación

- **WHEN** se pide `GET /accounts?sort_by=balance&order=desc`
- **THEN** `data` viene ordenado por `balance` de mayor a menor

#### Scenario: Ordenación por un campo no permitido

- **WHEN** se pide `GET /accounts?sort_by=credit_limit_secret`
- **THEN** el sistema responde `400 Bad Request` en lugar de pasar el campo a la consulta

#### Scenario: Paginación

- **WHEN** existen 30 cuentas y se pide `GET /accounts?page=2&limit=10`
- **THEN** `data` contiene las cuentas 11 a 20 según el orden aplicado, `total` es 30, `page` es 2 y `limit` es 10

#### Scenario: Parámetros de paginación inválidos

- **WHEN** se pide `GET /accounts?page=0` o `GET /accounts?limit=500`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Actualizar una cuenta

El sistema SHALL exponer `PATCH /accounts/:id`, que actualiza parcialmente una cuenta. Todos los campos MUST ser opcionales y los ausentes MUST conservar su valor actual.

La coherencia entre `type` y `credit_limit` MUST evaluarse contra el estado resultante de la cuenta, no sólo contra los campos enviados.

#### Scenario: Actualización parcial correcta

- **WHEN** se envía `PATCH /accounts/1` con `{ "name": "Efectivo caja" }`
- **THEN** el sistema responde `200 OK` con la cuenta actualizada y `balance`, `type` y `credit_limit` mantienen sus valores previos

#### Scenario: Cambio a tarjeta de crédito aportando el límite

- **WHEN** la cuenta 1 es `CASH` y se envía `PATCH /accounts/1` con `{ "type": "CREDIT_CARD", "credit_limit": 1500 }`
- **THEN** el sistema responde `200 OK` y la cuenta queda como `CREDIT_CARD` con límite 1500

#### Scenario: Cambio a tarjeta de crédito sin aportar el límite

- **WHEN** la cuenta 1 es `CASH` con `credit_limit` a `null` y se envía `PATCH /accounts/1` con `{ "type": "CREDIT_CARD" }`
- **THEN** el sistema responde `400 Bad Request` porque el estado resultante sería una tarjeta de crédito sin límite, y la cuenta no se modifica

#### Scenario: Cambio desde tarjeta de crédito a otro tipo

- **WHEN** la cuenta 2 es `CREDIT_CARD` con límite 2000 y se envía `PATCH /accounts/2` con `{ "type": "DEBIT_CARD" }`
- **THEN** el sistema responde `200 OK`, la cuenta queda como `DEBIT_CARD` y su `credit_limit` pasa a `null`

#### Scenario: La cuenta no existe

- **WHEN** se envía `PATCH /accounts/9999` y esa cuenta no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Borrar una cuenta sin transacciones asociadas

El sistema SHALL exponer `DELETE /accounts/:id`, que borra la cuenta indicada únicamente si no tiene incomes ni expenses asociados.

#### Scenario: Borrado correcto

- **WHEN** se envía `DELETE /accounts/1`, la cuenta existe y no tiene incomes ni expenses
- **THEN** el sistema responde `200 OK` y la cuenta deja de existir

#### Scenario: La cuenta no existe

- **WHEN** se envía `DELETE /accounts/9999` y esa cuenta no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Protección de borrado de cuentas en uso

El sistema SHALL rechazar el borrado de una cuenta que tenga incomes o expenses asociados, respondiendo `409 Conflict` con un mensaje que indique cuántas transacciones lo impiden. El sistema MUST NOT borrar en cascada las transacciones asociadas.

#### Scenario: La cuenta tiene incomes asociados

- **WHEN** se envía `DELETE /accounts/1` y la cuenta 1 tiene 3 incomes
- **THEN** el sistema responde `409 Conflict`, la cuenta sigue existiendo y los 3 incomes siguen existiendo

#### Scenario: La cuenta tiene expenses asociados

- **WHEN** se envía `DELETE /accounts/1` y la cuenta 1 tiene 5 expenses
- **THEN** el sistema responde `409 Conflict`, la cuenta sigue existiendo y los 5 expenses siguen existiendo

#### Scenario: El error de FK nunca se filtra como 500

- **WHEN** una restricción de clave ajena impide el borrado por una carrera entre la comprobación y el `DELETE`
- **THEN** el sistema responde `409 Conflict` y no un `500 Internal Server Error`
