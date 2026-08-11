## ADDED Requirements

### Requirement: Solo el admin puede administrar invitaciones

`POST /invitations`, `GET /invitations` y `DELETE /invitations/:id` SHALL exigir, respectivamente, los permisos `invitation:create`, `invitation:read` e `invitation:delete`. Ninguno de los tres MUST llevar `@Public()`.

#### Scenario: Usuario sin permiso intenta invitar

- **WHEN** un usuario autenticado sin el permiso `invitation:create` envía `POST /invitations`
- **THEN** el sistema responde `403 Forbidden` y no crea ninguna invitación

#### Scenario: Admin invita correctamente

- **WHEN** un usuario con el permiso `invitation:create` envía `POST /invitations` con `{ "email": "nueva@empresa.com" }`
- **THEN** el sistema responde `201 Created` con la invitación creada en estado `PENDING`

### Requirement: Invitar un email

El sistema SHALL exponer `POST /invitations` con body `{ email: string }`. Si no existe ninguna invitación para ese email, MUST crear una nueva en estado `PENDING`, registrando `invited_by` con el `id` del admin que la creó.

Si ya existe una invitación `PENDING` o `ACTIVE` para ese email, el sistema SHALL rechazar la petición con `409 Conflict` sin modificar la fila existente.

Si existe una invitación `REVOKED` para ese email, el sistema SHALL reactivarla en vez de crear una fila nueva: si tiene `user_id` vinculado pasa a `ACTIVE`, si no tiene `user_id` pasa a `PENDING`.

#### Scenario: Invitar un email que nunca fue invitado

- **WHEN** se envía `POST /invitations` con `{ "email": "ana@empresa.com" }` y no existe ninguna invitación previa para ese email
- **THEN** el sistema responde `201 Created` con `status: "PENDING"` y `user_id: null`

#### Scenario: Invitar un email con formato inválido

- **WHEN** se envía `POST /invitations` con `{ "email": "no-es-un-email" }`
- **THEN** el sistema responde `400 Bad Request` y no crea ninguna invitación

#### Scenario: Invitar un email ya invitado y pendiente

- **WHEN** se envía `POST /invitations` con un email cuya invitación existente está en `PENDING`
- **THEN** el sistema responde `409 Conflict` y no modifica la invitación existente

#### Scenario: Invitar un email que ya tiene cuenta activa

- **WHEN** se envía `POST /invitations` con un email cuya invitación existente está en `ACTIVE`
- **THEN** el sistema responde `409 Conflict`

#### Scenario: Reinvitar un email revocado que ya tenía cuenta

- **WHEN** se envía `POST /invitations` con un email cuya invitación existente está en `REVOKED` y tiene `user_id` asignado
- **THEN** el sistema responde `200 OK` (o `201 Created`) con la misma invitación ahora en `status: "ACTIVE"`, y el usuario vinculado puede volver a loguear

#### Scenario: Reinvitar un email revocado que nunca se registró

- **WHEN** se envía `POST /invitations` con un email cuya invitación existente está en `REVOKED` y `user_id` es `null`
- **THEN** la invitación queda en `status: "PENDING"`

### Requirement: Listar invitaciones

El sistema SHALL exponer `GET /invitations`, que devuelve todas las invitaciones con `email`, `status`, `user_id`, `invited_by`, `created_at`, `accepted_at` y `revoked_at`.

#### Scenario: Listado incluye invitaciones en cualquier estado

- **WHEN** se pide `GET /invitations` y existen invitaciones en `PENDING`, `ACTIVE` y `REVOKED`
- **THEN** el sistema responde `200 OK` con las tres, sin filtrar por estado por defecto

### Requirement: Revocar el acceso de una invitación

El sistema SHALL exponer `DELETE /invitations/:id`, que MUST marcar la invitación como `REVOKED` (revocación blanda: la fila no se borra). Si la invitación tenía un usuario vinculado, ese usuario MUST dejar de poder loguear (por email/password o Google) de inmediato tras la revocación, sin necesidad de invalidar tokens JWT ya emitidos por separado.

#### Scenario: Revocar el acceso de un usuario con cuenta

- **WHEN** un admin envía `DELETE /invitations/:id` de una invitación `ACTIVE` con `user_id` asignado
- **THEN** el sistema responde `200 OK`, la invitación queda en `status: "REVOKED"`, y una petición posterior de `POST /auth/login` con las credenciales correctas de ese usuario responde `401 Unauthorized`

#### Scenario: Revocar una invitación que no existe

- **WHEN** se envía `DELETE /invitations/:id` con un `id` que no corresponde a ninguna invitación
- **THEN** el sistema responde `404 Not Found`

### Requirement: El registro con email y contraseña requiere invitación

`POST /auth/user` SHALL rechazar con `403 Forbidden` la creación de una cuenta si no existe una invitación en estado `PENDING` para el email enviado. El usuario MUST NOT crearse en ese caso.

Si existe una invitación `PENDING` para el email, el sistema MUST crear el usuario y, en la misma operación, actualizar esa invitación a `status: "ACTIVE"` con `user_id` apuntando al usuario recién creado y `accepted_at` con la fecha actual.

#### Scenario: Registro sin invitación

- **WHEN** se envía `POST /auth/user` con un email que no tiene ninguna invitación `PENDING`
- **THEN** el sistema responde `403 Forbidden` y no se crea ningún usuario

#### Scenario: Registro con invitación revocada

- **WHEN** se envía `POST /auth/user` con un email cuya invitación está en `REVOKED`
- **THEN** el sistema responde `403 Forbidden` y no se crea ningún usuario

#### Scenario: Registro con invitación pendiente

- **WHEN** se envía `POST /auth/user` con un email que tiene una invitación `PENDING`
- **THEN** el sistema responde `201 Created` con el usuario creado, y la invitación correspondiente pasa a `status: "ACTIVE"` vinculada a ese usuario

### Requirement: El login con email y contraseña respeta el acceso revocado

`POST /auth/login` SHALL responder `401 Unauthorized` si la invitación vinculada al usuario está en `REVOKED`, incluso cuando la contraseña enviada sea correcta. Un usuario sin ninguna fila de invitación asociada (estado anómalo, no debería ocurrir tras el backfill) SHALL tratarse igual que `REVOKED`.

#### Scenario: Login con acceso revocado

- **WHEN** se envía `POST /auth/login` con email y contraseña correctos, pero la invitación del usuario está en `REVOKED`
- **THEN** el sistema responde `401 Unauthorized`

#### Scenario: Login con acceso activo

- **WHEN** se envía `POST /auth/login` con email y contraseña correctos, y la invitación del usuario está en `ACTIVE`
- **THEN** el sistema responde `200 OK` con `{ access_token }`

### Requirement: El login y registro con Google requieren invitación

`POST /auth/login/google` SHALL aplicar el mismo gate que el registro por email/password cuando el email verificado por Google no corresponde a ninguna cuenta existente: si no hay una invitación `PENDING` para ese email, el sistema MUST responder `403 Forbidden` y no crear ninguna cuenta.

Cuando el email sí corresponde a una cuenta existente, el sistema SHALL aplicar el mismo chequeo de acceso revocado que `POST /auth/login`: si la invitación del usuario está en `REVOKED`, MUST responder `401 Unauthorized` sin importar que el token de Google sea válido.

#### Scenario: Primer login con Google sin invitación

- **WHEN** se envía `POST /auth/login/google` con un `credential` válido cuyo email no tiene cuenta ni invitación `PENDING`
- **THEN** el sistema responde `403 Forbidden` y no se crea ninguna cuenta

#### Scenario: Primer login con Google con invitación pendiente

- **WHEN** se envía `POST /auth/login/google` con un `credential` válido cuyo email tiene una invitación `PENDING` y no tiene cuenta
- **THEN** el sistema responde `200 OK` con `{ access_token }`, crea la cuenta, y la invitación pasa a `status: "ACTIVE"` vinculada al usuario nuevo

#### Scenario: Login con Google sobre cuenta con acceso revocado

- **WHEN** se envía `POST /auth/login/google` con un `credential` válido cuyo email corresponde a una cuenta existente con invitación `REVOKED`
- **THEN** el sistema responde `401 Unauthorized`

#### Scenario: Login con Google sobre cuenta con acceso activo

- **WHEN** se envía `POST /auth/login/google` con un `credential` válido cuyo email corresponde a una cuenta existente con invitación `ACTIVE`
- **THEN** el sistema responde `200 OK` con `{ access_token }`, igual que antes de este cambio

### Requirement: Los usuarios existentes antes de este cambio conservan su acceso

Toda fila de `User` que exista al momento de desplegar este cambio SHALL quedar asociada a una invitación en `status: "ACTIVE"`, generada automáticamente por una migración de datos, sin intervención del admin.

#### Scenario: Usuario preexistente sigue pudiendo loguear

- **WHEN** un usuario que ya tenía cuenta antes de este cambio envía `POST /auth/login` con sus credenciales correctas, después de desplegado el cambio
- **THEN** el sistema responde `200 OK` con `{ access_token }`, sin que el admin haya tenido que invitarlo explícitamente
