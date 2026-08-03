## ADDED Requirements

### Requirement: Todo dato financiero tiene un propietario

`Account`, `Income` y `Expense` SHALL tener un `user_id` obligatorio con clave ajena a `User`. Ninguna fila de esas tablas puede existir sin propietario.

`Tax` MUST quedar fuera de este requisito: el catálogo de impuestos es común a la instalación.

#### Scenario: Toda cuenta tiene dueño

- **WHEN** se consulta cualquier fila de `accounts`, `incomes` o `expenses` tras la migración
- **THEN** su `user_id` apunta a un usuario existente y no es nulo

#### Scenario: Los impuestos no tienen dueño

- **WHEN** se consulta la tabla `taxes`
- **THEN** no existe ninguna columna `user_id`

### Requirement: El propietario se asigna desde el token

En toda creación de un recurso con propietario, el sistema SHALL tomar el `user_id` del JWT de la petición. El `user_id` MUST NOT poder indicarse en el cuerpo, la ruta ni la query.

#### Scenario: Creación asigna al usuario del token

- **WHEN** un usuario con `id` 1 envía `POST /incomes` con un body válido
- **THEN** el income creado tiene `user_id` igual a 1

#### Scenario: Intento de crear a nombre de otro

- **WHEN** un usuario envía `POST /incomes` con `"user_id": 2` en el cuerpo
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: Intento de reasignar el propietario

- **WHEN** un usuario envía `PATCH /incomes/1` con `"user_id": 2`
- **THEN** el sistema responde `400 Bad Request` y el propietario no se modifica

### Requirement: Las lecturas se filtran según el scope del permiso

Cuando el permiso efectivo del usuario sobre un recurso tenga scope `OWN`, las lecturas SHALL devolver únicamente las filas cuyo `user_id` coincida con el del token. Cuando el scope sea `ANY`, SHALL devolver todas.

Si el usuario posee el permiso en ambos scopes, `ANY` MUST prevalecer.

#### Scenario: Listado con scope OWN

- **WHEN** un usuario con `income:read` en scope `OWN` pide `GET /incomes` y existen ingresos suyos y de otros
- **THEN** `data` contiene únicamente sus ingresos

#### Scenario: El total refleja el filtro de propiedad

- **WHEN** un usuario con scope `OWN` tiene 3 ingresos y en la tabla hay 40 en total
- **THEN** `GET /incomes` devuelve `total` igual a 3, no 40

#### Scenario: Listado con scope ANY

- **WHEN** un administrador con `income:read` en scope `ANY` pide `GET /incomes`
- **THEN** `data` contiene los ingresos de todos los usuarios

#### Scenario: ANY prevalece sobre OWN

- **WHEN** un usuario cuyo rol incluye `income:read` tanto en `OWN` como en `ANY` pide `GET /incomes`
- **THEN** el sistema aplica `ANY` y devuelve los ingresos de todos

#### Scenario: Consulta por id de un recurso ajeno

- **WHEN** un usuario con scope `OWN` pide `GET /incomes/5` y ese income pertenece a otro usuario
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Consulta por id de un recurso ajeno con scope ANY

- **WHEN** un administrador con scope `ANY` pide `GET /incomes/5` y ese income pertenece a otro usuario
- **THEN** el sistema responde `200 OK` con el income

#### Scenario: El filtro de propiedad se combina con los demás filtros

- **WHEN** un usuario con scope `OWN` pide `GET /incomes?start_date=2026-01-01&search=factura`
- **THEN** el resultado cumple los tres criterios a la vez y `total` cuenta sólo sus ingresos que además cumplen los filtros

### Requirement: Escribir sobre un recurso ajeno responde 404

Cuando un usuario con scope `OWN` intente actualizar o borrar un recurso que no le pertenece, el sistema SHALL responder `404 Not Found`, con la misma respuesta que si el recurso no existiera.

El sistema MUST NOT distinguir en la respuesta entre "no existe" y "existe pero no es tuyo".

#### Scenario: Actualizar un recurso ajeno

- **WHEN** un usuario con scope `OWN` envía `PATCH /incomes/5` sobre un income de otro usuario
- **THEN** el sistema responde `404 Not Found` y el income no se modifica

#### Scenario: Borrar un recurso ajeno

- **WHEN** un usuario con scope `OWN` envía `DELETE /accounts/5` sobre una cuenta de otro usuario
- **THEN** el sistema responde `404 Not Found` y la cuenta se conserva

#### Scenario: Un recurso ajeno y uno inexistente son indistinguibles

- **WHEN** un usuario pide un id que pertenece a otro usuario y otro id que no existe en absoluto
- **THEN** ambas peticiones devuelven `404 Not Found` con la misma forma de respuesta, sin filtrar la existencia del primero

#### Scenario: Escritura sobre recurso propio

- **WHEN** un usuario con scope `OWN` envía `PATCH /incomes/1` sobre un income suyo
- **THEN** el sistema responde `200 OK` y aplica el cambio

### Requirement: Las referencias entre recursos respetan la propiedad

El sistema SHALL rechazar cualquier operación que relacione un recurso con otro perteneciente a un usuario distinto.

#### Scenario: Crear un income contra una cuenta ajena

- **WHEN** un usuario envía `POST /incomes` con un `account_id` que pertenece a otro usuario
- **THEN** el sistema responde `400 Bad Request` y no crea el income

#### Scenario: Mover un income a una cuenta ajena

- **WHEN** un usuario envía `PATCH /incomes/1` con un `account_id` que pertenece a otro usuario
- **THEN** el sistema responde `400 Bad Request` y el income no se modifica

#### Scenario: Crear un expense contra una cuenta ajena

- **WHEN** un usuario envía `POST /expenses` con un `account_id` de otro usuario
- **THEN** el sistema responde `400 Bad Request` y no crea el expense

#### Scenario: Los impuestos siguen siendo comunes

- **WHEN** un usuario crea un income con `tax_ids` del catálogo común
- **THEN** la operación se completa con normalidad, sin comprobación de propiedad sobre los impuestos

### Requirement: Los contadores y agregados son relativos al solicitante

Los recuentos que acompañan a un recurso SHALL calcularse sobre el conjunto visible para el usuario que pregunta, con el mismo criterio de scope que las lecturas.

#### Scenario: Contadores de una cuenta con scope OWN

- **WHEN** un usuario con scope `OWN` pide `GET /accounts/1` sobre una cuenta suya
- **THEN** `incomes_count` y `expenses_count` cuentan únicamente los movimientos de ese usuario

#### Scenario: Protección de borrado coherente con lo visible

- **WHEN** un usuario intenta borrar una cuenta suya que sólo tiene movimientos suyos
- **THEN** el `409 Conflict` de la protección de borrado se calcula sobre esos movimientos, con el mismo recuento que muestra el detalle

### Requirement: La migración adjudica las filas existentes sin pérdida

La migración SHALL asignar un propietario a todas las filas preexistentes de `accounts`, `incomes` y `expenses`, y MUST NOT borrar ninguna fila.

Dado que en MySQL las sentencias DDL provocan un commit implícito y la migración no puede ser atómica, ésta SHALL comprobar sus precondiciones **antes** de ejecutar la primera sentencia DDL, y SHALL ordenarse de forma que cada paso intermedio deje la base de datos en un estado consultable.

#### Scenario: Ninguna fila se pierde

- **WHEN** se aplica la migración sobre una base de datos con datos preexistentes
- **THEN** el número de filas de `accounts`, `incomes` y `expenses` es idéntico antes y después

#### Scenario: Ninguna fila queda sin propietario

- **WHEN** se consulta cualquiera de las tres tablas tras aplicar la migración
- **THEN** no existe ninguna fila con `user_id` nulo

#### Scenario: Precondición comprobada antes de tocar el esquema

- **WHEN** se intenta aplicar la migración y no existe ningún usuario al que adjudicar las filas
- **THEN** la migración se detiene antes de ejecutar ninguna sentencia DDL y el esquema queda intacto

#### Scenario: La columna se restringe sólo después del backfill

- **WHEN** se aplica la migración sobre tablas con filas preexistentes
- **THEN** la columna `user_id` se crea admitiendo nulos, se rellena para todas las filas, y sólo entonces se restringe a `NOT NULL` y se le añade la clave ajena

#### Scenario: Verificación posterior antes de dar por buena la migración

- **WHEN** termina la migración
- **THEN** una consulta de comprobación confirma que ninguna de las tres tablas tiene filas con `user_id` nulo antes de considerar el despliegue correcto
