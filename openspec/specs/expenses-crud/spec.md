# Expenses CRUD

## Purpose

Proveer un CRUD completo, autenticado y validado para el recurso `expenses` de la API, con paridad total de comportamiento con `/incomes`, incluyendo soporte para filtrado, paginación, ordenación y gestión de la relación con taxes.

## Requirements

### Requirement: Autenticación obligatoria en los endpoints de expenses

Todos los endpoints bajo `/expenses` SHALL exigir un JWT válido. El `ExpensesController` MUST NOT llevar el decorador `@Public()`.

#### Scenario: Petición sin token

- **WHEN** se hace cualquier petición a `/expenses` sin cabecera `Authorization`
- **THEN** el sistema responde `401 Unauthorized` y no ejecuta ninguna consulta a la base de datos

#### Scenario: Petición con token válido

- **WHEN** se hace una petición a `/expenses` con un JWT firmado con `JWT_SECRET` y no caducado
- **THEN** el sistema procesa la petición normalmente

### Requirement: Crear un expense

El sistema SHALL exponer `POST /expenses`, que crea un gasto a partir de `amount`, `concept`, `date`, `invoiced`, `account_id` y, opcionalmente, `tax_ids`.

`amount` MUST ser un número; `concept` MUST ser una cadena no vacía; `date` MUST ser una fecha ISO 8601 válida; `invoiced` MUST ser booleano; `account_id` MUST ser un entero. Campos no reconocidos en el body MUST ser rechazados.

#### Scenario: Creación correcta

- **WHEN** se envía `POST /expenses` con `{ "amount": 89.9, "concept": "Material oficina", "date": "2026-02-10T00:00:00.000Z", "invoiced": true, "account_id": 1 }` y la cuenta 1 existe
- **THEN** el sistema responde `201 Created` con el expense creado, su `id` generado, su `created_at` y un array `taxes` vacío

#### Scenario: Creación con taxes asociados

- **WHEN** se envía `POST /expenses` con un body válido que incluye `"tax_ids": [1, 2]` y ambos taxes existen
- **THEN** el sistema crea el expense, crea las filas correspondientes en `expense_taxes` y devuelve el expense con sus dos taxes

#### Scenario: Falta un campo obligatorio

- **WHEN** se envía `POST /expenses` sin `concept`
- **THEN** el sistema responde `400 Bad Request` con un mensaje que identifica el campo inválido, y no crea ningún registro

#### Scenario: Tipo de campo incorrecto

- **WHEN** se envía `POST /expenses` con `"amount": "caro"`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Campo desconocido en el body

- **WHEN** se envía `POST /expenses` con un body válido más `"category": "oficina"`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: La cuenta referenciada no existe

- **WHEN** se envía `POST /expenses` con `"account_id": 9999` y esa cuenta no existe
- **THEN** el sistema responde `400 Bad Request` indicando que la cuenta no existe, y no crea ningún registro

#### Scenario: Un tax referenciado no existe

- **WHEN** se envía `POST /expenses` con `"tax_ids": [1, 9999]` y el tax 9999 no existe
- **THEN** el sistema responde `400 Bad Request`, y ni el expense ni ninguna fila de `expense_taxes` quedan creados

### Requirement: Consultar un expense por id

El sistema SHALL exponer `GET /expenses/:id`, que devuelve un único gasto con sus taxes asociados.

#### Scenario: El expense existe

- **WHEN** se pide `GET /expenses/1` y el expense 1 existe
- **THEN** el sistema responde `200 OK` con el expense y su array `taxes`

#### Scenario: El expense no existe

- **WHEN** se pide `GET /expenses/9999` y ese expense no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: El id no es numérico

- **WHEN** se pide `GET /expenses/abc`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Listar expenses con filtros y paginación

El sistema SHALL exponer `GET /expenses`, que devuelve un objeto `{ data, total, page, limit }` donde `data` es la página solicitada y `total` es el número de expenses que cumplen los filtros, ignorando la paginación.

El endpoint MUST aplicar los parámetros `start_date`, `end_date`, `search`, `account_id`, `sort_by`, `order`, `page` y `limit`. Los parámetros ausentes MUST usar sus valores por defecto y no restringir el resultado.

#### Scenario: Listado sin parámetros

- **WHEN** se pide `GET /expenses` sin query params
- **THEN** el sistema responde `200 OK` con la primera página usando `page=1` y `limit=20`, ordenada por `date` descendente, y `total` refleja el total de expenses

#### Scenario: Filtro por rango de fechas

- **WHEN** se pide `GET /expenses?start_date=2026-02-01&end_date=2026-02-28`
- **THEN** `data` sólo contiene expenses cuyo `date` está dentro del rango, ambos extremos incluidos, y `total` cuenta sólo esos

#### Scenario: Sólo fecha de inicio

- **WHEN** se pide `GET /expenses?start_date=2026-02-01`
- **THEN** `data` sólo contiene expenses con `date` mayor o igual a esa fecha, sin límite superior

#### Scenario: Búsqueda por concepto

- **WHEN** se pide `GET /expenses?search=oficina`
- **THEN** `data` sólo contiene expenses cuyo `concept` contiene la subcadena `oficina`, sin distinguir mayúsculas de minúsculas

#### Scenario: Filtro por cuenta

- **WHEN** se pide `GET /expenses?account_id=2`
- **THEN** `data` sólo contiene expenses de la cuenta 2 y `total` cuenta sólo esos

#### Scenario: Filtro por una cuenta sin gastos

- **WHEN** se pide `GET /expenses?account_id=7` y la cuenta 7 no tiene gastos
- **THEN** el sistema responde `200 OK` con `data` vacío y `total` a 0, sin error

#### Scenario: Ordenación

- **WHEN** se pide `GET /expenses?sort_by=amount&order=desc`
- **THEN** `data` viene ordenado por `amount` de mayor a menor

#### Scenario: Ordenación por un campo no permitido

- **WHEN** se pide `GET /expenses?sort_by=account_secret`
- **THEN** el sistema responde `400 Bad Request` en lugar de pasar el campo a la consulta

#### Scenario: Paginación

- **WHEN** existen 42 expenses y se pide `GET /expenses?page=2&limit=20`
- **THEN** `data` contiene los expenses 21 a 40 según el orden aplicado, `total` es 42, `page` es 2 y `limit` es 20

#### Scenario: Página más allá del final

- **WHEN** existen 42 expenses y se pide `GET /expenses?page=99&limit=20`
- **THEN** el sistema responde `200 OK` con `data` vacío y `total` igual a 42

#### Scenario: Parámetros de paginación inválidos

- **WHEN** se pide `GET /expenses?page=0` o `GET /expenses?limit=500`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Filtros combinados

- **WHEN** se pide `GET /expenses?start_date=2026-02-01&search=oficina&account_id=1&sort_by=date&order=asc&page=1&limit=10`
- **THEN** todos los filtros se aplican conjuntamente y `total` cuenta los expenses que cumplen el conjunto completo

### Requirement: Actualizar un expense

El sistema SHALL exponer `PATCH /expenses/:id`, que actualiza parcialmente un gasto. Todos los campos MUST ser opcionales y los ausentes MUST conservar su valor actual.

#### Scenario: Actualización parcial correcta

- **WHEN** se envía `PATCH /expenses/1` con `{ "amount": 120 }`
- **THEN** el sistema responde `200 OK` con el expense actualizado, y `concept`, `date`, `invoiced` y `account_id` mantienen sus valores previos

#### Scenario: Reemplazo de los taxes asociados

- **WHEN** el expense 1 tiene los taxes `[1, 2]` y se envía `PATCH /expenses/1` con `{ "tax_ids": [2, 3] }`
- **THEN** el expense queda asociado exactamente a los taxes 2 y 3, y la asociación con el tax 1 se elimina

#### Scenario: Vaciar los taxes asociados

- **WHEN** se envía `PATCH /expenses/1` con `{ "tax_ids": [] }`
- **THEN** el expense queda sin taxes asociados

#### Scenario: No tocar los taxes

- **WHEN** se envía `PATCH /expenses/1` con `{ "concept": "Nuevo concepto" }` y sin la clave `tax_ids`
- **THEN** los taxes asociados al expense permanecen sin cambios

#### Scenario: El expense no existe

- **WHEN** se envía `PATCH /expenses/9999` y ese expense no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Referencia inválida en la actualización

- **WHEN** se envía `PATCH /expenses/1` con `"account_id": 9999` y esa cuenta no existe
- **THEN** el sistema responde `400 Bad Request` y el expense no se modifica

### Requirement: Borrar un expense

El sistema SHALL exponer `DELETE /expenses/:id`, que borra el gasto indicado junto con sus filas en `expense_taxes`.

#### Scenario: Borrado correcto

- **WHEN** se envía `DELETE /expenses/1` y el expense 1 existe
- **THEN** el sistema responde `200 OK`, el expense deja de existir y sus filas en `expense_taxes` se eliminan en cascada

#### Scenario: El expense no existe

- **WHEN** se envía `DELETE /expenses/9999` y ese expense no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Comportamiento consistente entre expenses e incomes

Los endpoints de `/expenses` SHALL exponer la misma forma de respuesta, los mismos códigos de error y la misma semántica de filtros que los de `/incomes`, de modo que un cliente pueda tratarlos con el mismo código.

#### Scenario: Misma forma de respuesta paginada

- **WHEN** se comparan las respuestas de `GET /incomes` y `GET /expenses` sin parámetros
- **THEN** ambas tienen exactamente las claves `data`, `total`, `page` y `limit`, con los mismos tipos y los mismos valores por defecto

#### Scenario: Misma semántica de tax_ids

- **WHEN** se envía un `PATCH` con `tax_ids` ausente, con `[]` y con una lista no vacía, tanto a `/incomes/:id` como a `/expenses/:id`
- **THEN** en ambos recursos: ausente no toca la relación, `[]` la vacía y una lista la reemplaza por completo

#### Scenario: Mismos códigos de error

- **WHEN** se provoca un id inexistente, un `account_id` inválido y un `sort_by` no permitido en ambos recursos
- **THEN** ambos responden `404`, `400` y `400` respectivamente
