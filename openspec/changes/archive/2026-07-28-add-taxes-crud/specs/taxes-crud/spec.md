## ADDED Requirements

### Requirement: Autenticación obligatoria en los endpoints de taxes

Todos los endpoints bajo `/taxes` SHALL exigir un JWT válido. El `TaxesController` MUST NOT llevar el decorador `@Public()`.

#### Scenario: Petición sin token

- **WHEN** se hace cualquier petición a `/taxes` sin cabecera `Authorization`
- **THEN** el sistema responde `401 Unauthorized` y no ejecuta ninguna consulta a la base de datos

#### Scenario: Petición con token válido

- **WHEN** se hace una petición a `/taxes` con un JWT firmado con `JWT_SECRET` y no caducado
- **THEN** el sistema procesa la petición normalmente

### Requirement: Crear un impuesto

El sistema SHALL exponer `POST /taxes`, que crea un impuesto a partir de `name` y `rate`.

`name` MUST ser una cadena no vacía; `rate` MUST ser un número entre 0 y 100 inclusive, interpretado como porcentaje. Campos no reconocidos en el body MUST ser rechazados.

#### Scenario: Creación correcta

- **WHEN** se envía `POST /taxes` con `{ "name": "IVA", "rate": 21 }`
- **THEN** el sistema responde `201 Created` con el impuesto creado, su `id` generado y su `created_at`

#### Scenario: Tipo cero

- **WHEN** se envía `POST /taxes` con `{ "name": "Exento", "rate": 0 }`
- **THEN** el sistema responde `201 Created` — un tipo del 0 % es válido

#### Scenario: Tipo con decimales

- **WHEN** se envía `POST /taxes` con `{ "name": "IRPF reducido", "rate": 7.5 }`
- **THEN** el sistema responde `201 Created` y el `rate` se conserva como 7.5

#### Scenario: Tipo fuera de rango

- **WHEN** se envía `POST /taxes` con `"rate": 150` o con `"rate": -5`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Nombre vacío

- **WHEN** se envía `POST /taxes` con `{ "name": "", "rate": 21 }`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Campo desconocido en el body

- **WHEN** se envía `POST /taxes` con un body válido más `"country": "ES"`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

### Requirement: Unicidad del nombre de impuesto

El sistema SHALL rechazar la creación o renombrado de un impuesto cuyo `name` coincida con el de otro impuesto ya existente, respondiendo `409 Conflict`. La comparación MUST ignorar los espacios en blanco al principio y al final del nombre.

#### Scenario: Nombre duplicado en la creación

- **WHEN** ya existe un impuesto llamado `IVA` y se envía `POST /taxes` con `{ "name": "IVA", "rate": 10 }`
- **THEN** el sistema responde `409 Conflict` y no crea ningún registro

#### Scenario: Nombre duplicado con espacios sobrantes

- **WHEN** ya existe un impuesto llamado `IVA` y se envía `POST /taxes` con `{ "name": "  IVA  ", "rate": 10 }`
- **THEN** el sistema responde `409 Conflict` y no crea ningún registro

#### Scenario: Renombrado a un nombre ya ocupado

- **WHEN** existen los impuestos `IVA` e `IRPF` y se envía `PATCH /taxes/<id-de-IRPF>` con `{ "name": "IVA" }`
- **THEN** el sistema responde `409 Conflict` y el impuesto no se modifica

#### Scenario: Renombrado al propio nombre

- **WHEN** se envía `PATCH /taxes/1` con el mismo `name` que ya tiene el impuesto 1
- **THEN** el sistema responde `200 OK` y no lo trata como un conflicto consigo mismo

### Requirement: Consultar un impuesto por id

El sistema SHALL exponer `GET /taxes/:id`, que devuelve un único impuesto junto con el número de incomes y expenses que lo utilizan.

#### Scenario: El impuesto existe

- **WHEN** se pide `GET /taxes/1` y el impuesto 1 existe, usado por 4 incomes y 2 expenses
- **THEN** el sistema responde `200 OK` con el impuesto y unos contadores que indican 4 incomes y 2 expenses

#### Scenario: El impuesto no existe

- **WHEN** se pide `GET /taxes/9999` y ese impuesto no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: El id no es numérico

- **WHEN** se pide `GET /taxes/abc`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Listar impuestos con filtros y paginación

El sistema SHALL exponer `GET /taxes`, que devuelve un objeto `{ data, total, page, limit }` donde `data` es la página solicitada y `total` es el número de impuestos que cumplen los filtros, ignorando la paginación.

El endpoint MUST aceptar `search`, `sort_by`, `order`, `page` y `limit`. Los parámetros ausentes MUST usar sus valores por defecto y no restringir el resultado.

#### Scenario: Listado sin parámetros

- **WHEN** se pide `GET /taxes` sin query params
- **THEN** el sistema responde `200 OK` con la primera página usando `page=1` y `limit=20`, ordenada por `name` ascendente, y `total` refleja el total de impuestos

#### Scenario: Búsqueda por nombre

- **WHEN** se pide `GET /taxes?search=iva`
- **THEN** `data` sólo contiene impuestos cuyo `name` contiene la subcadena `iva`, sin distinguir mayúsculas de minúsculas

#### Scenario: Ordenación por tipo

- **WHEN** se pide `GET /taxes?sort_by=rate&order=desc`
- **THEN** `data` viene ordenado por `rate` de mayor a menor

#### Scenario: Ordenación por un campo no permitido

- **WHEN** se pide `GET /taxes?sort_by=created_by`
- **THEN** el sistema responde `400 Bad Request` en lugar de pasar el campo a la consulta

#### Scenario: Paginación

- **WHEN** existen 25 impuestos y se pide `GET /taxes?page=2&limit=10`
- **THEN** `data` contiene los impuestos 11 a 20 según el orden aplicado, `total` es 25, `page` es 2 y `limit` es 10

#### Scenario: Parámetros de paginación inválidos

- **WHEN** se pide `GET /taxes?page=0` o `GET /taxes?limit=500`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Actualizar un impuesto

El sistema SHALL exponer `PATCH /taxes/:id`, que actualiza parcialmente un impuesto. Todos los campos MUST ser opcionales y los ausentes MUST conservar su valor actual.

#### Scenario: Actualización del tipo

- **WHEN** se envía `PATCH /taxes/1` con `{ "rate": 10 }`
- **THEN** el sistema responde `200 OK` con el impuesto actualizado y su `name` mantiene el valor previo

#### Scenario: Tipo fuera de rango en la actualización

- **WHEN** se envía `PATCH /taxes/1` con `{ "rate": 200 }`
- **THEN** el sistema responde `400 Bad Request` y el impuesto no se modifica

#### Scenario: El impuesto no existe

- **WHEN** se envía `PATCH /taxes/9999` y ese impuesto no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Cambiar el tipo de un impuesto en uso

- **WHEN** se envía `PATCH /taxes/1` con `{ "rate": 10 }` y el impuesto 1 está asociado a incomes existentes
- **THEN** el sistema responde `200 OK` y actualiza el impuesto, sin bloquear la operación por estar en uso

### Requirement: Borrar un impuesto sin uso

El sistema SHALL exponer `DELETE /taxes/:id`, que borra el impuesto indicado únicamente si no está asociado a ningún income ni expense.

#### Scenario: Borrado correcto

- **WHEN** se envía `DELETE /taxes/1`, el impuesto existe y no lo usa ningún income ni expense
- **THEN** el sistema responde `200 OK` y el impuesto deja de existir

#### Scenario: El impuesto no existe

- **WHEN** se envía `DELETE /taxes/9999` y ese impuesto no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Protección de borrado de impuestos en uso

El sistema SHALL rechazar el borrado de un impuesto asociado a algún income o expense, respondiendo `409 Conflict` con un mensaje que indique cuántos registros lo impiden. El sistema MUST NOT permitir que el `onDelete: Cascade` declarado en `IncomeTax` y `ExpenseTax` elimine esas asociaciones.

#### Scenario: El impuesto está asociado a incomes

- **WHEN** se envía `DELETE /taxes/1` y el impuesto 1 está asociado a 4 incomes
- **THEN** el sistema responde `409 Conflict`, el impuesto sigue existiendo y los 4 incomes conservan su asociación

#### Scenario: El impuesto está asociado a expenses

- **WHEN** se envía `DELETE /taxes/1` y el impuesto 1 está asociado a 2 expenses
- **THEN** el sistema responde `409 Conflict`, el impuesto sigue existiendo y los 2 expenses conservan su asociación

#### Scenario: Las asociaciones históricas nunca se pierden silenciosamente

- **WHEN** se intenta borrar un impuesto en uso por cualquier vía de la API
- **THEN** ninguna fila de `income_taxes` ni de `expense_taxes` resulta eliminada
