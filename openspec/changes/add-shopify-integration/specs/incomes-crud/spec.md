## MODIFIED Requirements

### Requirement: Crear un income

El sistema SHALL exponer `POST /incomes`, que crea un income a partir de `amount`, `concept`, `date`, `invoiced`, `account_id` y, opcionalmente, `tax_ids`.

`amount` MUST ser un número; `concept` MUST ser una cadena no vacía; `date` MUST ser una fecha ISO 8601 válida; `invoiced` MUST ser booleano; `account_id` MUST ser un entero. Campos no reconocidos en el body MUST ser rechazados.

Todo income creado por esta vía SHALL tener `source` y `external_reference` a `null` — estos campos MUST NOT poder establecerse desde `POST /incomes` ni `PATCH /incomes/:id`; sólo la sincronización de Shopify los puebla.

#### Scenario: Creación correcta

- **WHEN** se envía `POST /incomes` con `{ "amount": 1500.5, "concept": "Factura enero", "date": "2026-01-31T00:00:00.000Z", "invoiced": true, "account_id": 1 }` y la cuenta 1 existe
- **THEN** el sistema responde `201 Created` con el income creado, incluyendo su `id` generado, su `created_at`, un array `taxes` vacío, y `source`/`external_reference` a `null`

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

#### Scenario: Intento de establecer el origen manualmente

- **WHEN** se envía `POST /incomes` con `"source": "shopify"` en el body
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro, porque `source` no es un campo aceptado por este endpoint

### Requirement: Listar incomes con filtros y paginación

El sistema SHALL exponer `GET /incomes`, que devuelve un objeto `{ data, total, page, limit }` donde `data` es el array de incomes de la página solicitada y `total` es el número de incomes que cumplen los filtros, ignorando la paginación.

El endpoint MUST aplicar realmente los parámetros de `FilteredInput` recibidos por query string: `start_date`, `end_date`, `search`, `sort_by`, `order`, `page` y `limit`. Los parámetros ausentes MUST usar sus valores por defecto y no restringir el resultado.

Cada income de `data` SHALL incluir sus campos `source` y `external_reference`, para que un cliente pueda distinguir visualmente los ingresos sincronizados de los introducidos a mano.

#### Scenario: Listado sin parámetros

- **WHEN** se pide `GET /incomes` sin query params
- **THEN** el sistema responde `200 OK` con la primera página de incomes usando los valores por defecto `page=1` y `limit=20`, y `total` refleja el total de incomes de la tabla

#### Scenario: Un listado mixto distingue el origen

- **WHEN** existen incomes creados manualmente e incomes creados por la sincronización de Shopify
- **THEN** `GET /incomes` los devuelve a todos con la misma forma, y cada uno indica su `source` correctamente — `null` para los manuales, `"shopify"` para los sincronizados

#### Scenario: Filtro por rango de fechas

- **WHEN** se pide `GET /incomes?start_date=2026-01-01&end_date=2026-01-31`
- **THEN** `data` sólo contiene incomes cuyo campo `date` está dentro del rango, ambos extremos incluidos, y `total` cuenta sólo esos incomes

#### Scenario: Búsqueda por concepto

- **WHEN** se pide `GET /incomes?search=factura`
- **THEN** `data` sólo contiene incomes cuyo `concept` contiene la subcadena `factura`, sin distinguir mayúsculas de minúsculas

#### Scenario: Ordenación

- **WHEN** se pide `GET /incomes?sort_by=amount&order=desc`
- **THEN** `data` viene ordenado por `amount` de mayor a menor

#### Scenario: Paginación

- **WHEN** existen 42 incomes y se pide `GET /incomes?page=2&limit=20`
- **THEN** `data` contiene los incomes 21 a 40 según el orden aplicado, `total` es 42, `page` es 2 y `limit` es 20

### Requirement: Actualizar un income

El sistema SHALL exponer `PATCH /incomes/:id`, que actualiza parcialmente un income. Todos los campos MUST ser opcionales y los campos ausentes MUST conservar su valor actual.

El sistema MUST permitir editar libremente cualquier income, incluidos los sincronizados desde Shopify — no existe un estado de "sólo lectura". Los campos `source` y `external_reference` MUST NOT poder modificarse por esta vía; MUST conservar su valor aunque el resto del income cambie.

#### Scenario: Actualización parcial correcta

- **WHEN** se envía `PATCH /incomes/1` con `{ "amount": 2000 }`
- **THEN** el sistema responde `200 OK` con el income actualizado, y `concept`, `date`, `invoiced` y `account_id` mantienen sus valores previos

#### Scenario: Editar un income sincronizado

- **WHEN** se envía `PATCH /incomes/1` con `{ "amount": 500 }` sobre un income cuyo `source` es `"shopify"`
- **THEN** el sistema responde `200 OK`, el monto se actualiza, y `source` y `external_reference` conservan sus valores originales

#### Scenario: Intento de modificar el origen

- **WHEN** se envía `PATCH /incomes/1` con `{ "source": null }` o `{ "external_reference": "editado" }`
- **THEN** el sistema responde `400 Bad Request` y el income no se modifica

#### Scenario: El income no existe

- **WHEN** se envía `PATCH /incomes/9999` y ese income no existe
- **THEN** el sistema responde `404 Not Found`
