## Why

Hoy `POST /auth/user` y `POST /auth/login/google` dejan crear una cuenta a cualquiera que llegue al endpoint — no hay forma de restringir quién puede entrar a la aplicación. El admin necesita controlar el acceso: solo las personas que él invite por email deben poder registrarse o loguearse, y debe poder revocar ese acceso después.

## What Changes

- Nuevo modelo `Invitation`: whitelist de emails administrada por el admin, sin envío de correo — el admin agrega el email, la persona se registra normal (email/password o Google) y el sistema valida contra esa lista.
- **BREAKING**: `POST /auth/user` rechaza con `403` el registro de cualquier email sin invitación pendiente.
- **BREAKING**: `POST /auth/login/google` rechaza con `403` la creación de una cuenta nueva para un email sin invitación pendiente (el login de una cuenta Google ya existente sigue funcionando, sujeto al chequeo de acceso revocado descrito abajo).
- Todo login (`POST /auth/login` y `POST /auth/login/google` sobre cuenta existente) valida que la invitación asociada al usuario no esté revocada; si lo está, responde `401` aunque la contraseña o el token de Google sean correctos.
- Backfill de datos: todos los usuarios existentes en la base antes de este cambio quedan con una invitación en estado `ACTIVE`, como si ya hubieran sido invitados — no se bloquea a nadie retroactivamente por este cambio.
- Nuevos endpoints de administración (permiso `invitation:*`, solo rol admin):
  - `POST /invitations` — invita un email nuevo (o reactiva uno revocado).
  - `GET /invitations` — lista invitaciones con su estado y, si aplica, el usuario vinculado.
  - `DELETE /invitations/:id` — revoca el acceso (soft: pasa a `REVOKED`, no borra el historial). Si el email ya tiene cuenta, esa cuenta deja de poder loguear de inmediato.

## Capabilities

### New Capabilities
- `invitations`: whitelist de emails gestionada por el admin, y el gate de registro/login (email+password y Google) contra esa whitelist, incluyendo la revocación de acceso.

### Modified Capabilities
(ninguna — `user-profile` no cambia sus requisitos existentes; los endpoints de `/auth` que toca este cambio no están cubiertos por ningún spec previo)

## Impact

- **Schema**: nueva tabla `invitations` (`email` único, `status`, `user_id` nullable FK a `users`, `invited_by` FK a `users`, timestamps). Migración de datos que backfillea una fila `ACTIVE` por cada usuario existente.
- **Backend**: `AuthService.signIn` y `AuthService.googleLogin` (chequeo de invitación revocada en cada login), `UserService.createUser` (gate de registro), nuevo módulo `InvitationsModule` (controller + service), nuevas entradas en `permission-catalog.ts`.
- **Frontend** (`paldex-app`): fuera de alcance de este change — solo se pide la parte de backend/admin. El frontend seguirá recibiendo `403`/`401` de la API cuando el registro/login sea rechazado; el manejo de esos mensajes en la UI no está cubierto aquí.
- **No afecta**: `/auth/login/google` para una cuenta ya `ACTIVE` sin invitación revocada, ni ningún endpoint fuera de `/auth` y `/user`.
