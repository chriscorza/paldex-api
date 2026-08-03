# User Profile

## Purpose

Exponer endpoints de perfil propio (`/user/me`) para que el usuario autenticado pueda consultar, editar y dar de baja su cuenta. Establece además la invariante de que `password` y `google_token_id` nunca salen de la API.

## Requirements

### Requirement: La contraseña nunca sale de la API

Ninguna respuesta de la API SHALL incluir el campo `password` de un usuario, con independencia del módulo o el endpoint que la genere. El campo `google_token_id` MUST recibir el mismo trato.

Esta restricción MUST implementarse mediante una proyección explícita en la consulta a la base de datos, de modo que la columna no llegue a formar parte del objeto devuelto por el service. `AuthService.signIn` es la única excepción autorizada a leer la columna, y MUST NOT devolverla a ningún handler.

#### Scenario: El registro no devuelve la contraseña

- **WHEN** se envía `POST /auth/user` con `{ "email": "a@b.com", "password": "secreto", "name": "Ana" }`
- **THEN** el sistema responde `201 Created` con el usuario creado y el cuerpo de la respuesta **no** contiene ninguna clave `password`

#### Scenario: El registro no devuelve el token de Google

- **WHEN** se envía `POST /auth/user` con un body que incluye `google_token_id`
- **THEN** el cuerpo de la respuesta no contiene ninguna clave `google_token_id`

#### Scenario: El perfil propio no devuelve la contraseña

- **WHEN** se pide `GET /user/me` con un JWT válido
- **THEN** el cuerpo de la respuesta no contiene ninguna clave `password` ni `google_token_id`

#### Scenario: La actualización del perfil no devuelve la contraseña

- **WHEN** se envía `PATCH /user/me` con un cambio válido
- **THEN** el usuario actualizado que se devuelve no contiene ninguna clave `password`

#### Scenario: El login sigue pudiendo comparar la contraseña

- **WHEN** se envía `POST /auth/login` con credenciales correctas
- **THEN** el sistema responde `200 OK` con `{ access_token }` y sin ningún dato del usuario más allá del token

### Requirement: Autenticación obligatoria en los endpoints de perfil

Todos los endpoints bajo `/user` SHALL exigir un JWT válido. El `UserController` MUST NOT llevar el decorador `@Public()`.

#### Scenario: Petición sin token

- **WHEN** se hace cualquier petición a `/user/me` sin cabecera `Authorization`
- **THEN** el sistema responde `401 Unauthorized` y no ejecuta ninguna consulta a la base de datos

#### Scenario: Petición con token inválido

- **WHEN** se hace una petición a `/user/me` con un token no firmado con `JWT_SECRET` o caducado
- **THEN** el sistema responde `401 Unauthorized`

### Requirement: Consultar el perfil propio

El sistema SHALL exponer `GET /user/me`, que devuelve el perfil del usuario identificado por el `id` del JWT.

El usuario a devolver MUST resolverse a partir del payload del token y MUST NOT poder indicarse por parámetro de ruta, query o body.

#### Scenario: Perfil existente

- **WHEN** se pide `GET /user/me` con un JWT cuyo payload tiene `id: 1` y el usuario 1 existe
- **THEN** el sistema responde `200 OK` con `id`, `email`, `name`, `photo_url`, `locale` y `created_at` del usuario 1

#### Scenario: El usuario del token ya no existe

- **WHEN** se pide `GET /user/me` con un JWT válido cuyo `id` corresponde a un usuario que fue borrado
- **THEN** el sistema responde `404 Not Found` y no un `500`

#### Scenario: No se puede consultar el perfil de otro usuario

- **WHEN** se pide `GET /user/me?id=2` con un JWT cuyo payload tiene `id: 1`
- **THEN** el sistema devuelve el perfil del usuario 1, ignorando por completo el parámetro

### Requirement: Actualizar el perfil propio

El sistema SHALL exponer `PATCH /user/me`, que actualiza parcialmente el perfil del usuario del token. Los campos editables MUST limitarse a `email`, `name`, `photo_url` y `locale`. Todos MUST ser opcionales y los ausentes MUST conservar su valor actual.

Los campos `id`, `password`, `google_token_id` y `created_at` MUST ser rechazados si aparecen en el body.

#### Scenario: Actualización del nombre

- **WHEN** se envía `PATCH /user/me` con `{ "name": "Ana García" }`
- **THEN** el sistema responde `200 OK` con el perfil actualizado y `email`, `photo_url` y `locale` mantienen sus valores previos

#### Scenario: Actualización del idioma

- **WHEN** se envía `PATCH /user/me` con `{ "locale": "en" }`
- **THEN** el sistema responde `200 OK` y el `locale` del usuario pasa a ser `en`

#### Scenario: Idioma no soportado

- **WHEN** se envía `PATCH /user/me` con `{ "locale": "fr" }`
- **THEN** el sistema responde `400 Bad Request` indicando los idiomas admitidos, y el perfil no se modifica

#### Scenario: Idioma que excede la longitud de la columna

- **WHEN** se envía `PATCH /user/me` con `{ "locale": "espanol" }`
- **THEN** el sistema responde `400 Bad Request` antes de intentar escribir en una columna `VARCHAR(3)`

#### Scenario: Intento de cambiar la contraseña por esta vía

- **WHEN** se envía `PATCH /user/me` con `{ "password": "nueva" }`
- **THEN** el sistema responde `400 Bad Request` y la contraseña no se modifica

#### Scenario: Intento de suplantar la identidad

- **WHEN** se envía `PATCH /user/me` con `{ "id": 2 }`
- **THEN** el sistema responde `400 Bad Request` y ningún usuario se modifica

#### Scenario: Intento de escribir el token de Google

- **WHEN** se envía `PATCH /user/me` con `{ "google_token_id": "..." }`
- **THEN** el sistema responde `400 Bad Request` y el perfil no se modifica

#### Scenario: Email con formato inválido

- **WHEN** se envía `PATCH /user/me` con `{ "email": "no-es-un-email" }`
- **THEN** el sistema responde `400 Bad Request` y el perfil no se modifica

### Requirement: Unicidad del email al actualizar el perfil

El sistema SHALL rechazar con `409 Conflict` el cambio de email a uno que ya pertenece a otro usuario. El error de restricción única de la base de datos MUST NOT propagarse como `500`.

#### Scenario: Email ya en uso por otro usuario

- **WHEN** el usuario 1 envía `PATCH /user/me` con un `email` que ya pertenece al usuario 2
- **THEN** el sistema responde `409 Conflict` y ningún usuario se modifica

#### Scenario: Email propio sin cambios

- **WHEN** el usuario 1 envía `PATCH /user/me` con su propio email actual
- **THEN** el sistema responde `200 OK` y no lo trata como un conflicto consigo mismo

#### Scenario: Carrera en la comprobación de unicidad

- **WHEN** la restricción única de la base de datos rechaza la escritura pese a haber pasado la comprobación previa
- **THEN** el sistema responde `409 Conflict` y no un `500 Internal Server Error`

### Requirement: Dar de baja el perfil propio

El sistema SHALL exponer `DELETE /user/me`, que borra el usuario identificado por el JWT.

#### Scenario: Baja correcta

- **WHEN** se envía `DELETE /user/me` con un JWT válido del usuario 1
- **THEN** el sistema responde `200 OK` y el usuario 1 deja de existir

#### Scenario: El usuario del token ya no existe

- **WHEN** se envía `DELETE /user/me` con un JWT cuyo `id` corresponde a un usuario ya borrado
- **THEN** el sistema responde `404 Not Found` y no un `500`

#### Scenario: El perfil deja de ser accesible tras la baja

- **WHEN** un usuario da de baja su cuenta y a continuación pide `GET /user/me` con el mismo token
- **THEN** el sistema responde `404 Not Found`

#### Scenario: No se puede dar de baja a otro usuario

- **WHEN** se envía `DELETE /user/me` con un body o query que intenta indicar otro `id`
- **THEN** el sistema borra únicamente el usuario del token, o rechaza la petición, pero en ningún caso borra a otro usuario
