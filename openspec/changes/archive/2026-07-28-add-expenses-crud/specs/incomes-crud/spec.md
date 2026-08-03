## MODIFIED Requirements

### Requirement: Listar incomes con filtros y paginación

El sistema SHALL exponer `GET /incomes`, que devuelve un objeto `{ data, total, page, limit }` donde `data` es el array de incomes de la página solicitada y `total` es el número de incomes que cumplen los filtros, ignorando la paginación.

El endpoint MUST aplicar realmente los parámetros de `FilteredInput` recibidos por query string: `start_date`, `end_date`, `search`, `sort_by`, `order`, `page` y `limit`. Los parámetros ausentes MUST usar sus valores por defecto y no restringir el resultado.

El endpoint MUST aceptar además el parámetro `account_id`, que restringe el resultado a los incomes de esa cuenta, con la misma semántica que el filtro homónimo de `GET /expenses`.

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

#### Scenario: Filtro por cuenta

- **WHEN** se pide `GET /incomes?account_id=2`
- **THEN** `data` sólo contiene incomes de la cuenta 2 y `total` cuenta sólo esos

#### Scenario: Filtro por una cuenta sin ingresos

- **WHEN** se pide `GET /incomes?account_id=7` y la cuenta 7 no tiene ingresos
- **THEN** el sistema responde `200 OK` con `data` vacío y `total` a 0, sin error

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

#### Scenario: Filtros combinados incluyendo cuenta

- **WHEN** se pide `GET /incomes?start_date=2026-01-01&account_id=1&search=factura&page=1&limit=10`
- **THEN** todos los filtros se aplican conjuntamente, incluido `account_id`, y `total` cuenta los incomes que cumplen el conjunto completo
