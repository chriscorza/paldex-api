## ADDED Requirements

### Requirement: Autenticación obligatoria en los endpoints de incomes

Todos los endpoints bajo `/incomes` SHALL exigir un JWT válido. El `IncomesController` MUST NOT llevar el decorador `@Public()`, de modo que el `AuthGuard` global registrado vía `APP_GUARD` valide cada petición.

#### Scenario: Petición sin token

- **WHEN** se hace cualquier petición a `/incomes` sin cabecera `Authorization`
- **THEN** el sistema responde `401 Unauthorized` y no ejecuta ninguna consulta a la base de datos

#### Scenario: Petición con token inválido o caducado

- **WHEN** se hace una petición a `/incomes` con `Authorization: Bearer <token-inválido>`
- **THEN** el sistema responde `401 Unauthorized`

#### Scenario: Petición con token válido

- **WHEN** se hace una petición a `/incomes` con `Authorization: Bearer <jwt-firmado-con-JWT_SECRET-y-no-caducado>`
- **THEN** el sistema procesa la petición normalmente

### Requirement: Crear un income

El sistema SHALL exponer `POST /incomes`, que crea un income a partir de `amount`, `concept`, `date`, `invoiced`, `account_id` y, opcionalmente, `tax_ids`.

`amount` MUST ser un número; `concept` MUST ser una cadena no vacía; `date` MUST ser una fecha ISO 8601 válida; `invoiced` MUST ser booleano; `account_id` MUST ser un entero. Campos no reconocidos en el body MUST ser rechazados.

#### Scenario: Creación correcta

- **WHEN** se envía `POST /incomes` con `{ "amount": 1500.5, "concept": "Factura enero", "date": "2026-01-31T00:00:00.000Z", "invoiced": true, "account_id": 1 }` y la cuenta 1 existe
- **THEN** el sistema responde `201 Created` con el income creado, incluyendo su `id` generado, su `created_at` y un array `taxes` vacío

#### Scenario: Creación con taxes asociados

- **WHEN** se envía `POST /incomes` con un body válido que incluye `"tax_ids": [1, 2]` y ambos taxes existen
- **THEN** el sistema crea el income, crea las filas correspondientes en `income_taxes` y devuelve el income con sus dos taxes

#### Scenario: Falta un campo obligatorio

- **WHEN** se envía `POST /incomes` sin `concept`
- **THEN** el sistema responde `400 Bad Request` con un mensaje que identifica el campo inválido, y no crea ningún registro

#### Scenario: Tipo de campo incorrecto

- **WHEN** se envía `POST /incomes` con `"amount": "mucho dinero"`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Campo desconocido en el body

- **WHEN** se envía `POST /incomes` con un body válido más `"is_admin": true`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: La cuenta referenciada no existe

- **WHEN** se envía `POST /incomes` con `"account_id": 9999` y esa cuenta no existe
- **THEN** el sistema responde `400 Bad Request` indicando que la cuenta no existe, y no crea ningún registro

#### Scenario: Un tax referenciado no existe

- **WHEN** se envía `POST /incomes` con `"tax_ids": [1, 9999]` y el tax 9999 no existe
- **THEN** el sistema responde `400 Bad Request`, y ni el income ni ninguna fila de `income_taxes` quedan creados

### Requirement: Consultar un income por id

El sistema SHALL exponer `GET /incomes/:id`, que devuelve un único income con sus taxes asociados.

#### Scenario: El income existe

- **WHEN** se pide `GET /incomes/1` y el income 1 existe
- **THEN** el sistema responde `200 OK` con el income y su array `taxes`

#### Scenario: El income no existe

- **WHEN** se pide `GET /incomes/9999` y ese income no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: El id no es numérico

- **WHEN** se pide `GET /incomes/abc`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Listar incomes con filtros y paginación

El sistema SHALL exponer `GET /incomes`, que devuelve un objeto `{ data, total, page, limit }` donde `data` es el array de incomes de la página solicitada y `total` es el número de incomes que cumplen los filtros, ignorando la paginación.

El endpoint MUST aplicar realmente los parámetros de `FilteredInput` recibidos por query string: `start_date`, `end_date`, `search`, `sort_by`, `order`, `page` y `limit`. Los parámetros ausentes MUST usar sus valores por defecto y no restringir el resultado.

#### Scenario: Listado sin parámetros

- **WHEN** se pide `GET /incomes` sin query params
- **THEN** el sistema responde `200 OK` con la primera página de incomes usando los valores por defecto `page=1` y `limit=20`, y `total` refleja el total de incomes de la tabla

#### Scenario: Filtro por rango de fechas

- **WHEN** se pide `GET /incomes?start_date=2026-01-01&end_date=2026-01-31`
- **THEN** `data` sólo contiene incomes cuyo campo `date` está dentro del rango, ambos extremos incluidos, y `total` cuenta sólo esos incomes

#### Scenario: Sólo fecha de inicio

- **WHEN** se pide `GET /incomes?start_date=2026-01-01`
- **THEN** `data` sólo contiene incomes con `date` mayor o igual a esa fecha, sin límite superior

#### Scenario: Búsqueda por concepto

- **WHEN** se pide `GET /incomes?search=factura`
- **THEN** `data` sólo contiene incomes cuyo `concept` contiene la subcadena `factura`, sin distinguir mayúsculas de minúsculas

#### Scenario: Ordenación

- **WHEN** se pide `GET /incomes?sort_by=amount&order=desc`
- **THEN** `data` viene ordenado por `amount` de mayor a menor

#### Scenario: Ordenación por un campo no permitido

- **WHEN** se pide `GET /incomes?sort_by=password`
- **THEN** el sistema responde `400 Bad Request` en lugar de pasar el campo a la consulta

#### Scenario: Paginación

- **WHEN** existen 42 incomes y se pide `GET /incomes?page=2&limit=20`
- **THEN** `data` contiene los incomes 21 a 40 según el orden aplicado, `total` es 42, `page` es 2 y `limit` es 20

#### Scenario: Página más allá del final

- **WHEN** existen 42 incomes y se pide `GET /incomes?page=99&limit=20`
- **THEN** el sistema responde `200 OK` con `data` vacío y `total` igual a 42

#### Scenario: Parámetros de paginación inválidos

- **WHEN** se pide `GET /incomes?page=0` o `GET /incomes?limit=-5`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Filtros combinados

- **WHEN** se pide `GET /incomes?start_date=2026-01-01&search=factura&sort_by=date&order=asc&page=1&limit=10`
- **THEN** todos los filtros se aplican conjuntamente y `total` cuenta los incomes que cumplen el conjunto completo de filtros

### Requirement: Actualizar un income

El sistema SHALL exponer `PATCH /incomes/:id`, que actualiza parcialmente un income. Todos los campos MUST ser opcionales y los campos ausentes MUST conservar su valor actual.

#### Scenario: Actualización parcial correcta

- **WHEN** se envía `PATCH /incomes/1` con `{ "amount": 2000 }`
- **THEN** el sistema responde `200 OK` con el income actualizado, y `concept`, `date`, `invoiced` y `account_id` mantienen sus valores previos

#### Scenario: Reemplazo de los taxes asociados

- **WHEN** el income 1 tiene los taxes `[1, 2]` y se envía `PATCH /incomes/1` con `{ "tax_ids": [2, 3] }`
- **THEN** el income queda asociado exactamente a los taxes 2 y 3, y la asociación con el tax 1 se elimina

#### Scenario: Vaciar los taxes asociados

- **WHEN** se envía `PATCH /incomes/1` con `{ "tax_ids": [] }`
- **THEN** el income queda sin taxes asociados

#### Scenario: No tocar los taxes

- **WHEN** se envía `PATCH /incomes/1` con `{ "concept": "Nuevo concepto" }` y sin la clave `tax_ids`
- **THEN** los taxes asociados al income permanecen sin cambios

#### Scenario: El income no existe

- **WHEN** se envía `PATCH /incomes/9999` y ese income no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Referencia inválida en la actualización

- **WHEN** se envía `PATCH /incomes/1` con `"account_id": 9999` y esa cuenta no existe
- **THEN** el sistema responde `400 Bad Request` y el income no se modifica

### Requirement: Borrar un income

El sistema SHALL exponer `DELETE /incomes/:id`, que borra el income indicado junto con sus filas en `income_taxes`.

#### Scenario: Borrado correcto

- **WHEN** se envía `DELETE /incomes/1` y el income 1 existe
- **THEN** el sistema responde `200 OK`, el income deja de existir y sus filas en `income_taxes` se eliminan en cascada

#### Scenario: El income no existe

- **WHEN** se envía `DELETE /incomes/9999` y ese income no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Validación global de entrada

La aplicación SHALL registrar un `ValidationPipe` global con `whitelist`, `forbidNonWhitelisted` y `transform` activados, de modo que los DTOs se validen y los query params numéricos lleguen a los handlers ya convertidos a `number`.

#### Scenario: Los query params numéricos llegan tipados

- **WHEN** se pide `GET /incomes?page=2&limit=10`
- **THEN** el handler recibe `page` y `limit` como `number`, no como `string`

#### Scenario: Los endpoints de auth siguen operativos

- **WHEN** se envía `POST /auth/login` con `{ "email": "...", "password": "..." }` tras activar el pipe global
- **THEN** la petición se procesa con normalidad y no es rechazada por la validación
