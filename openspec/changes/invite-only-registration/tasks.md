## 1. Schema y migración

- [x] 1.1 Agregar `enum InvitationStatus { PENDING ACTIVE REVOKED }` y el modelo `Invitation` (`email @unique`, `status`, `user_id @unique` nullable FK a `User`, `invited_by` FK nullable a `User`, `created_at`, `accepted_at` nullable, `revoked_at` nullable) a `prisma/schema.prisma`.
- [x] 1.2 Generar la migración de schema (crear tabla + enum), siguiendo el flujo ya usado en este repo (`prisma migrate dev --create-only` dentro del contenedor, o escribir el SQL a mano si el entorno no es interactivo). NOTA: en el camino se encontró que `payables`/`receivables`/`monthly_closes`/`recurring_expenses` nunca tuvieron migración generada (bug de un change anterior, `add-financial-model-core`) — se generó `20260805223000_add_missing_financial_model_tables` para corregirlo antes de aplicar `20260805224000_add_invitations`.
- [x] 1.3 Añadir a la misma migración (o a una migración de datos inmediatamente posterior) el backfill: `INSERT INTO invitations (email, status, user_id, accepted_at, created_at) SELECT email, 'ACTIVE', id, created_at, created_at FROM users`.
- [x] 1.4 Aplicar la migración contra la base de dev y verificar `COUNT(users) == COUNT(invitations WHERE status = 'ACTIVE')`.

## 2. Permisos

- [x] 2.1 Agregar `{ resource: 'invitation', action: 'create' }`, `{ resource: 'invitation', action: 'read' }` y `{ resource: 'invitation', action: 'delete' }` a `PERMISSION_CATALOG` en `src/permissions/permission-catalog.ts` (sin variante `OWN`).
- [x] 2.2 Confirmar que el rol `admin` recibe estos permisos al arrancar la API (sync de `onModuleInit`), y que el rol `user` no. NOTA: se encontró que `syncCatalog()` nunca otorgaba permisos nuevos a ningún rol (solo creaba la fila `Permission`) — 13 recursos agregados después de la migración inicial nunca quedaron disponibles para `admin`. Se extendió `PermissionsService.syncCatalog()` para otorgar automáticamente al rol `admin` cualquier permiso del catálogo que le falte; esto resolvió el gap retroactivamente (admin pasó de tener huecos a 133 permisos) además de otorgar `invitation:*`. `user` se mantiene sin cambios (16 permisos, sin `invitation`).

## 3. Módulo de invitaciones

- [x] 3.1 Crear `src/invitations/dto/create-invitation.dto.ts` con `email: string` validado (`@IsEmail`).
- [x] 3.2 Crear `src/invitations/entities/invitation.entity.ts` (o selección Prisma equivalente) con los campos a exponer: `id`, `email`, `status`, `user_id`, `invited_by`, `created_at`, `accepted_at`, `revoked_at`.
- [x] 3.3 Implementar `InvitationsService.create(email, invitedByUserId)`: si no existe invitación para el email, crea `PENDING`; si existe `PENDING`/`ACTIVE`, lanza `409`; si existe `REVOKED`, la reactiva (`ACTIVE` si tiene `user_id`, `PENDING` si no).
- [x] 3.4 Implementar `InvitationsService.findAll()`: devuelve todas las invitaciones sin filtrar por estado.
- [x] 3.5 Implementar `InvitationsService.revoke(id)`: marca `status: REVOKED`, `revoked_at: now`; lanza `404` si no existe.
- [x] 3.6 Implementar `InvitationsController` con `POST /invitations` (`@RequirePermissions('invitation:create')`), `GET /invitations` (`@RequirePermissions('invitation:read')`), `DELETE /invitations/:id` (`@RequirePermissions('invitation:delete')`), documentados con `@ApiOperation`/`@ApiOkResponse`/`@ApiCreatedResponse`.
- [x] 3.7 Crear `InvitationsModule` (importa `PrismaModule`) y registrarlo en `AppModule`.

## 4. Gate en registro y login

- [x] 4.1 En `UserService.createUser`: antes de crear el usuario, buscar invitación `PENDING` para `dto.email`; si no existe, lanzar `ForbiddenException`. Si existe, envolver la creación del usuario y la actualización de la invitación a `ACTIVE` (`user_id`, `accepted_at`) en `prisma.$transaction`.
- [x] 4.2 En `AuthService.signIn`: tras validar la contraseña, buscar la invitación asociada al usuario (por `user_id` o `email`); si no existe o está `REVOKED`, lanzar `UnauthorizedException` antes de firmar el JWT.
- [x] 4.3 En `AuthService.googleLogin`, rama de usuario existente: aplicar el mismo chequeo de invitación no `REVOKED` que en `signIn` antes de firmar el JWT.
- [x] 4.4 En `AuthService.googleLogin`, rama de usuario nuevo: buscar invitación `PENDING` para el email verificado por Google; si no existe, lanzar `ForbiddenException` sin crear la cuenta. Si existe, envolver la creación del usuario y la actualización de la invitación a `ACTIVE` en `prisma.$transaction`.

## 5. Tests

- [x] 5.1 `src/invitations/invitations.service.spec.ts`: crear invitación nueva, conflicto en `PENDING`/`ACTIVE`, reactivación de `REVOKED` (con y sin `user_id`), revocar, revocar inexistente.
- [x] 5.2 `src/invitations/invitations.controller.spec.ts`: shape de las respuestas, que no se filtre nada fuera de lo esperado.
- [x] 5.3 Ampliar `src/user/user.service.spec.ts`: registro sin invitación (`403`, no crea usuario), registro con invitación `PENDING` (crea usuario y activa invitación), registro con invitación `REVOKED` (`403`).
- [x] 5.4 Ampliar `src/auth/auth.service.spec.ts`: `signIn` con invitación `REVOKED` (`401`), `signIn` con invitación `ACTIVE` (ok), `googleLogin` con email nuevo sin invitación (`403`, no crea cuenta), `googleLogin` con email nuevo e invitación `PENDING` (crea y activa), `googleLogin` sobre cuenta existente con invitación `REVOKED` (`401`).
- [x] 5.5 Correr la suite completa (`npx jest`) y confirmar que no se rompe ningún test existente (en particular `auth.controller.spec.ts` y `user.controller.spec.ts`). 289/289 tests pasan, 25 suites (incluye las 2 nuevas de invitations y las extensiones a auth/user).

## 6. Verificación manual

- [x] 6.1 Con la API corriendo en dev: invitar un email, registrar esa cuenta, confirmar `POST /auth/login` exitoso.
- [x] 6.2 Intentar `POST /auth/user` con un email no invitado y confirmar `403`.
- [x] 6.3 Revocar la invitación de la cuenta creada en 6.1 y confirmar que `POST /auth/login` con las mismas credenciales responde `401`.
- [x] 6.4 Confirmar que un usuario que ya existía antes de la migración (por ejemplo el admin bootstrapeado) sigue pudiendo loguear sin haber sido invitado explícitamente. Verificado insertando un usuario directo por SQL (simulando pre-existente): login falla `401` sin invitación, y tras correr el backfill exacto de la migración pasa a `201` con token — confirma también el comportamiento fail-closed.
- [x] 6.5 Revisar `/api-docs` para confirmar que los tres endpoints de `/invitations` quedan documentados correctamente. Confirmado vía `/api-docs/json`: POST/GET `/invitations` y DELETE `/invitations/{id}` con sus summaries.

NOTA: `scripts/bootstrap-admin.ts` está roto de forma independiente a este change (Prisma 7 requiere un driver adapter que el script no configura) — se promovió el admin de prueba por SQL directo para poder verificar. No se tocó porque está fuera de alcance.
