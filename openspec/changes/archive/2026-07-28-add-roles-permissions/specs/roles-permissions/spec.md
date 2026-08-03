## ADDED Requirements

### Requirement: Denegación por defecto

Toda ruta autenticada SHALL exigir un permiso declarado explícitamente. Una ruta que no lleve `@RequirePermissions()` y no esté marcada como `@Public()` MUST responder `403 Forbidden`, aunque el JWT sea válido.

#### Scenario: Ruta sin decorador de permisos

- **WHEN** un usuario autenticado con todos los permisos accede a una ruta que no declara ningún permiso y no es pública
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Ruta pública

- **WHEN** se accede sin token a una ruta marcada con `@Public()`
- **THEN** el sistema la sirve con normalidad y no evalúa permisos

#### Scenario: El orden de los guards permite resolver al usuario

- **WHEN** llega una petición autenticada a una ruta con permisos declarados
- **THEN** `AuthGuard` se ejecuta antes que `PermissionsGuard`, de modo que el segundo dispone del usuario que el primero deja en la petición

### Requirement: Comprobación de permisos por petición

El sistema SHALL resolver los permisos del usuario a partir de su rol persistido en base de datos en cada petición, y MUST NOT tomarlos del contenido del JWT.

Cuando un handler declara varios permisos, el usuario MUST poseerlos todos.

#### Scenario: El usuario tiene el permiso exigido

- **WHEN** un usuario cuyo rol incluye `income:read` pide `GET /incomes`
- **THEN** el sistema responde `200 OK`

#### Scenario: El usuario no tiene el permiso exigido

- **WHEN** un usuario cuyo rol no incluye `income:create` envía `POST /incomes`
- **THEN** el sistema responde `403 Forbidden` y no crea ningún registro

#### Scenario: Un permiso retirado surte efecto de inmediato

- **WHEN** se retira `income:create` del rol de un usuario y éste envía `POST /incomes` con el **mismo token** que ya tenía
- **THEN** el sistema responde `403 Forbidden`, sin necesidad de que el usuario vuelva a autenticarse

#### Scenario: Un permiso concedido surte efecto de inmediato

- **WHEN** se añade `income:create` al rol de un usuario y éste envía `POST /incomes` con el mismo token
- **THEN** el sistema responde `201 Created`

#### Scenario: Handler que exige varios permisos

- **WHEN** un usuario que tiene `income:read` pero no `account:read` accede a un handler que declara ambos
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Usuario sin rol asignado

- **WHEN** un usuario cuyo `role_id` es nulo accede a cualquier ruta con permisos declarados
- **THEN** el sistema responde `403 Forbidden`, tratando la ausencia de rol como ausencia de permisos

#### Scenario: Token de un usuario borrado

- **WHEN** se accede a una ruta protegida con un JWT válido cuyo usuario ha sido borrado de la base de datos
- **THEN** el sistema responde `401 Unauthorized`, porque el usuario no puede resolverse

### Requirement: Catálogo de permisos gobernado desde el código

Las filas de `Permission` SHALL sincronizarse al arrancar la aplicación desde una constante declarada en el código. El sistema MUST NOT ofrecer ninguna vía de API para crear, modificar ni borrar permisos.

La sincronización MUST dar de alta los permisos nuevos y MUST NOT borrar los que ya no figuren en la constante, para no retirar permisos de roles de forma implícita.

#### Scenario: Alta de permisos nuevos al arrancar

- **WHEN** la aplicación arranca con un permiso en la constante que no existe en la tabla
- **THEN** el permiso queda creado en la base de datos

#### Scenario: Arranques sucesivos no duplican

- **WHEN** la aplicación arranca dos veces seguidas sin cambios en la constante
- **THEN** la tabla de permisos contiene exactamente las mismas filas que tras el primer arranque

#### Scenario: Un permiso retirado de la constante no se borra

- **WHEN** la aplicación arranca y un permiso presente en la tabla ya no figura en la constante
- **THEN** la fila se conserva y el sistema deja constancia en el log, sin alterar los roles que la referencian

#### Scenario: No hay endpoint de creación de permisos

- **WHEN** se intenta un `POST /permissions`
- **THEN** el sistema responde `404 Not Found`, porque la ruta no existe

### Requirement: Consultar el catálogo de permisos

El sistema SHALL exponer `GET /permissions`, que devuelve el catálogo completo de permisos disponibles, para que una interfaz de administración pueda componer roles.

#### Scenario: Listado del catálogo

- **WHEN** un usuario con `permission:read` pide `GET /permissions`
- **THEN** el sistema responde `200 OK` con todos los permisos, cada uno con su `resource`, `action` y `scope`

#### Scenario: Sin el permiso necesario

- **WHEN** un usuario sin `permission:read` pide `GET /permissions`
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Administrar roles

El sistema SHALL exponer `GET /roles`, `GET /roles/:id`, `POST /roles`, `PATCH /roles/:id` y `DELETE /roles/:id`, todos protegidos por permisos del recurso `role`.

El `name` de un rol MUST ser único.

#### Scenario: Crear un rol

- **WHEN** un usuario con `role:create` envía `POST /roles` con `{ "name": "contable", "description": "Sólo lectura de finanzas" }`
- **THEN** el sistema responde `201 Created` con el rol creado y sin permisos asociados

#### Scenario: Nombre de rol duplicado

- **WHEN** se envía `POST /roles` con un `name` que ya existe
- **THEN** el sistema responde `409 Conflict` y no crea ningún registro

#### Scenario: Consultar un rol con sus permisos

- **WHEN** un usuario con `role:read` pide `GET /roles/:id` de un rol existente
- **THEN** el sistema responde `200 OK` con el rol y la lista de permisos que tiene concedidos

#### Scenario: El rol no existe

- **WHEN** se pide `GET /roles/9999` y ese rol no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Borrar un rol sin usuarios

- **WHEN** un usuario con `role:delete` envía `DELETE /roles/:id` de un rol que no es de sistema y no tiene usuarios asignados
- **THEN** el sistema responde `200 OK` y el rol deja de existir junto con sus filas de `role_permissions`

#### Scenario: Borrar un rol con usuarios asignados

- **WHEN** se envía `DELETE /roles/:id` de un rol que tiene usuarios asignados
- **THEN** el sistema responde `409 Conflict` indicando cuántos usuarios lo impiden, y ningún usuario se queda sin rol

#### Scenario: Sin el permiso necesario

- **WHEN** un usuario sin `role:create` envía `POST /roles`
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Fijar los permisos de un rol

El sistema SHALL exponer `PUT /roles/:id/permissions`, que reemplaza por completo el conjunto de permisos de un rol por el indicado.

La operación MUST ser idempotente: enviar el mismo conjunto dos veces deja el mismo estado.

#### Scenario: Reemplazo del conjunto de permisos

- **WHEN** un rol tiene los permisos `[1, 2]` y se envía `PUT /roles/:id/permissions` con `{ "permission_ids": [2, 3] }`
- **THEN** el rol queda con exactamente los permisos 2 y 3, y pierde el 1

#### Scenario: Vaciar los permisos de un rol

- **WHEN** se envía `PUT /roles/:id/permissions` con `{ "permission_ids": [] }` sobre un rol que no es de sistema
- **THEN** el rol queda sin ningún permiso y sus usuarios pasan a recibir `403` en toda ruta protegida

#### Scenario: Repetir la misma operación

- **WHEN** se envía dos veces seguidas `PUT /roles/:id/permissions` con el mismo `permission_ids`
- **THEN** el resultado de la segunda llamada es idéntico al de la primera y no se producen filas duplicadas

#### Scenario: Un permiso referenciado no existe

- **WHEN** se envía `PUT /roles/:id/permissions` con un `permission_id` que no está en el catálogo
- **THEN** el sistema responde `400 Bad Request` y el conjunto de permisos del rol no se modifica

### Requirement: Protección contra el bloqueo administrativo

El sistema SHALL impedir cualquier operación que deje el sistema sin capacidad de administrarse.

Los roles marcados como de sistema MUST NOT poder borrarse ni renombrarse. Al rol administrador MUST NOT poder retirársele los permisos que permiten volver a conceder permisos y asignar roles. El sistema MUST conservar en todo momento al menos un usuario con el rol administrador.

#### Scenario: Borrar un rol de sistema

- **WHEN** se envía `DELETE /roles/:id` sobre un rol con `is_system` a verdadero
- **THEN** el sistema responde `409 Conflict` y el rol se conserva

#### Scenario: Renombrar un rol de sistema

- **WHEN** se envía `PATCH /roles/:id` cambiando el `name` de un rol de sistema
- **THEN** el sistema responde `409 Conflict` y el nombre se conserva

#### Scenario: Retirar al administrador los permisos que le permiten recuperarse

- **WHEN** se envía `PUT /roles/<admin>/permissions` con un conjunto que no incluye `role:update` o no incluye `user:assign_role`
- **THEN** el sistema responde `409 Conflict` y los permisos del rol administrador no se modifican

#### Scenario: Cambiar el rol del último administrador

- **WHEN** sólo queda un usuario con rol administrador y se envía `PATCH /user/:id/role` sobre él asignándole otro rol
- **THEN** el sistema responde `409 Conflict` y el usuario conserva su rol

#### Scenario: Cambiar el rol de un administrador cuando hay otros

- **WHEN** existen dos usuarios con rol administrador y se cambia el rol de uno de ellos
- **THEN** el sistema responde `200 OK` y el cambio se aplica

### Requirement: Asignar un rol a un usuario

El sistema SHALL exponer `PATCH /user/:id/role`, protegido por el permiso `user:assign_role`, que asigna un rol existente a un usuario.

#### Scenario: Asignación correcta

- **WHEN** un usuario con `user:assign_role` envía `PATCH /user/2/role` con `{ "role_id": 3 }` y ambos existen
- **THEN** el sistema responde `200 OK` y el usuario 2 pasa a tener el rol 3

#### Scenario: El rol no existe

- **WHEN** se envía `PATCH /user/2/role` con un `role_id` inexistente
- **THEN** el sistema responde `400 Bad Request` y el usuario no se modifica

#### Scenario: El usuario no existe

- **WHEN** se envía `PATCH /user/9999/role` y ese usuario no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Sin el permiso necesario

- **WHEN** un usuario sin `user:assign_role` envía `PATCH /user/2/role`
- **THEN** el sistema responde `403 Forbidden` y ningún usuario se modifica

#### Scenario: El cambio de rol surte efecto inmediato

- **WHEN** se cambia el rol de un usuario que tiene una sesión activa
- **THEN** su siguiente petición se evalúa con los permisos del rol nuevo, sin volver a autenticarse

### Requirement: Listar usuarios

El sistema SHALL exponer `GET /user`, protegido por el permiso `user:read`, que devuelve la lista paginada de usuarios con la misma proyección pública que el resto de la API.

#### Scenario: Listado con permiso

- **WHEN** un usuario con `user:read` pide `GET /user`
- **THEN** el sistema responde `200 OK` con `{ data, total, page, limit }` y cada usuario incluye su rol

#### Scenario: La contraseña sigue sin salir

- **WHEN** se pide `GET /user` con permiso suficiente
- **THEN** ningún usuario de la respuesta contiene las claves `password` ni `google_token_id`

#### Scenario: Sin el permiso necesario

- **WHEN** un usuario sin `user:read` pide `GET /user`
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Consultar los permisos propios

El sistema SHALL exponer `GET /user/me/permissions`, accesible a cualquier usuario autenticado sin permiso adicional, que devuelve la lista de permisos efectivos del usuario del token.

#### Scenario: Consulta de permisos propios

- **WHEN** un usuario autenticado pide `GET /user/me/permissions`
- **THEN** el sistema responde `200 OK` con la lista de sus permisos efectivos y el nombre de su rol

#### Scenario: Usuario sin rol

- **WHEN** un usuario sin rol asignado pide `GET /user/me/permissions`
- **THEN** el sistema responde `200 OK` con una lista vacía, no un `403`

### Requirement: Caché de permisos coherente con las escrituras

El sistema SHALL cachear en memoria los permisos resueltos por rol para no consultar la base de datos en cada petición, y MUST invalidar la entrada correspondiente ante cualquier escritura que altere los permisos de ese rol.

#### Scenario: Invalidación al cambiar los permisos de un rol

- **WHEN** se ejecuta `PUT /roles/:id/permissions` sobre un rol cuyos permisos ya estaban cacheados
- **THEN** la siguiente petición de un usuario con ese rol se evalúa con el conjunto nuevo

#### Scenario: Invalidación al borrar un rol

- **WHEN** se borra un rol que estaba cacheado
- **THEN** la caché deja de contener su entrada

#### Scenario: Lecturas repetidas no consultan la base de datos

- **WHEN** un mismo usuario hace varias peticiones seguidas sin que cambien los permisos de su rol
- **THEN** los permisos se resuelven desde la caché tras la primera consulta
