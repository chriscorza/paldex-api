## Context

`POST /auth/user` (email/password) y `POST /auth/login/google` (creación implícita al primer login con Google) son hoy los dos únicos puntos de entrada para crear una cuenta, y ambos son `@Public()` sin ningún control de quién puede usarlos. El admin quiere convertir la app en invite-only: solo los emails que él agregue a una whitelist pueden registrarse, y debe poder revocar el acceso de alguien después (nuevo o ya existente).

No hay proveedor de correo en el proyecto (`v1` decidido explícitamente como whitelist pura, sin envío de email ni token de invitación) — el admin agrega el email, la persona se registra por su cuenta normal, y el sistema solo verifica que ese email esté en la lista.

## Goals / Non-Goals

**Goals:**
- El admin controla, vía API, qué emails pueden registrarse.
- El admin puede revocar el acceso de un usuario ya existente y que deje de poder loguear de inmediato (no solo bloquear registro futuro).
- Los usuarios que ya existían antes de este cambio no se ven afectados — quedan como si ya hubieran sido invitados.
- El gate cubre los tres puntos de entrada de auth: `POST /auth/user`, `POST /auth/login` y `POST /auth/login/google`.

**Non-Goals:**
- Envío de correos de invitación (sin proveedor de email en el proyecto; queda para un v2 si hace falta).
- Flujo de aceptación de invitación con token/link — la persona se registra directamente con su email y password (o Google), no hay paso intermedio.
- Cambios en el frontend (`paldex-app`) — este change es solo backend. La UI para gestionar invitaciones y el manejo de los nuevos `403`/`401` quedan fuera de alcance.
- Múltiples invitaciones históricas por email (reinvitar reutiliza la misma fila).

## Decisions

### Modelo `Invitation` separado, no un flag en `User`

Se agrega una tabla `invitations` en vez de, por ejemplo, un booleano `is_active` en `users`.

- Permite invitar un email **antes** de que exista la cuenta (whitelist real, no solo un toggle post-registro).
- Guarda quién invitó (`invited_by`) y cuándo, útil para auditoría — un flag en `User` no lo captura.
- Desacopla "¿puede registrarse?" de "¿existe la cuenta?": la validación de registro y la de revocación de acceso son la misma tabla, un solo lugar de verdad.

Alternativa descartada: agregar `access_revoked_at` a `User` y un campo `invited_by_admin` en el registro. Se descartó porque no soporta invitar un email que aún no tiene cuenta (requisito explícito del proyecto).

### Estados de `Invitation`: `PENDING` → `ACTIVE` → `REVOKED`

```
enum InvitationStatus {
  PENDING   // invitado, aún no se registró
  ACTIVE    // invitado y con cuenta creada (o backfilleado de un usuario preexistente)
  REVOKED   // acceso revocado por el admin; bloquea login aunque exista la cuenta
}
```

- `PENDING`: el email puede completar `POST /auth/user` o crear su cuenta vía `POST /auth/login/google`.
- `ACTIVE`: ya tiene `user_id` vinculado; puede loguear normalmente.
- `REVOKED`: el registro y todo login (password o Google) para ese email/usuario se rechazan, sin importar si la cuenta existe.

Reinvitar un email `REVOKED`: si ya tenía `user_id` (había cuenta), vuelve directo a `ACTIVE`. Si nunca se registró, vuelve a `PENDING`. Mismo row, se actualiza `status` (no se crean filas duplicadas — `email` es `@unique`).

### `email` único en `Invitation`, `user_id` único y nullable

- `email @unique`: una sola invitación viva por email; evita el caso de dos filas con estados contradictorios para el mismo email.
- `user_id @unique` (nullable, FK a `User`): 1:1 con la cuenta una vez creada. Nullable porque en `PENDING` todavía no existe el usuario.

### El gate vive en los services de auth existentes, no en un guard nuevo

`AuthService.signIn`, `AuthService.googleLogin` y `UserService.createUser` consultan `Invitation` directamente (vía `PrismaService`), en el mismo punto donde ya validan password/token. Se descartó un `InvitationGuard` global porque:
- El chequeo de registro (¿existe invitación `PENDING` para este email?) y el de login (¿la invitación del usuario no está `REVOKED`?) son consultas distintas — no es un simple guard de "¿está autenticado?", depende del flujo.
- Estos tres son los únicos puntos de entrada; un guard añadiría indirección sin ganar reutilización real.

### Módulo `InvitationsModule` nuevo, separado de `UserModule`

Nuevo `src/invitations/` con controller + service + DTOs, siguiendo el patrón ya establecido (`PrismaService` inyectado directo, sin capa de repositorio). Se agregan permisos `invitation:create`, `invitation:read`, `invitation:delete` al catálogo — sin variante `OWN`, porque las invitaciones no son un recurso propiedad del usuario, son administración global.

`DELETE /invitations/:id` hace **revocación blanda** (`status = REVOKED`), no borra la fila — se necesita conservar el vínculo `user_id` para poder reactivar y para que el chequeo de login seguido de la revocación tenga algo que consultar.

### Backfill de usuarios existentes

Migración de datos (SQL crudo dentro de la migración de Prisma) que inserta una fila `ACTIVE` por cada `User` ya existente, con `invited_by = NULL` (no hay un admin real que los haya invitado, son anteriores al feature) y `accepted_at = created_at` del usuario. Corre una sola vez, en la misma migración que crea la tabla, para que no haya ventana en la que un usuario existente quede sin invitación.

## Risks / Trade-offs

- **[Riesgo] Un usuario sin fila en `invitations` (por bug en el backfill o inserción manual directa a la tabla `users`) queda bloqueado de loguear.** → El backfill corre dentro de la misma transacción/migración que crea la tabla; se valida manualmente en staging que `COUNT(users) == COUNT(invitations WHERE status != REVOKED)` antes de desplegar a producción.
- **[Riesgo] Admin se revoca a sí mismo o revoca al último admin, quedando el sistema sin nadie que pueda re-invitar.** → Fuera de alcance de este change (igual que el "anti-lockout" de roles no cubre este caso); se documenta como limitación conocida. Se puede mitigar a futuro reutilizando la misma lógica de anti-lockout que ya existe para `role:update`/`user:assign_role`.
- **[Trade-off] Sin envío de correo, el admin tiene que comunicarle manualmente a la persona invitada que ya puede registrarse.** → Aceptado explícitamente para v1; la respuesta de `POST /invitations` devuelve el registro creado para que el admin pueda copiar/pegar el email si quiere avisar por otro canal.
- **[Riesgo] `POST /auth/login/google` para un email `PENDING` sin cuenta previa debe crear la cuenta Y marcar la invitación `ACTIVE` en la misma operación.** → Debe hacerse dentro de una transacción de Prisma (`$transaction`) para evitar una invitación `ACTIVE` sin usuario, o un usuario sin invitación, si algo falla a mitad de camino.

## Migration Plan

1. Migración de schema: crear tabla `invitations` + `InvitationStatus` enum.
2. Migración de datos (mismo archivo o inmediatamente después): backfill `ACTIVE` para todos los `users` existentes.
3. Deploy del código con el gate activo — a partir de este punto, cualquier registro/login nuevo pasa por la validación.
4. Rollback: si hace falta revertir, basta con desplegar el código anterior (sin gate); la tabla `invitations` puede quedar en la base sin problema porque nada más la consulta.
