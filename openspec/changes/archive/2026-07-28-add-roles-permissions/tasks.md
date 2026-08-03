## 1. Esquema y migración

- [x] 1.1 Añadir `PermissionScope { OWN ANY }` al schema
- [x] 1.2 Añadir modelo `Role`
- [x] 1.3 Añadir modelo `Permission`
- [x] 1.4 Añadir modelo `RolePermission`
- [x] 1.5 Añadir `role_id Int?` a `User`
- [x] 1.6 Generar migración `--create-only`
- [x] 1.7 Editar SQL con backfill (roles, permisos, asignaciones, UPDATE users)
- [x] 1.8 Aplicar migración y verificar: 0 null users, 2 roles, 26 perms, 42 asignaciones
- [x] 1.9 `prisma generate` y build pasan

## 2. Catálogo de permisos

- [x] 2.1 `PERMISSION_CATALOG` con 7 recursos × 4 acciones + user:assign_role (26 entradas)
- [x] 2.2 Tipo `PermissionString` derivado del catálogo
- [x] 2.3 `PermissionsService` con sync idempotente en `onModuleInit`
- [x] 2.4 No borra huérfanos, los registra en log
- [x] 2.5 Idempotencia verificada

## 3. Resolución y caché

- [x] 3.1 `resolvePermissions(roleId)` → `Map<permission, scope>`
- [x] 3.2 Caché `Map<role_id, perms>` en memoria
- [x] 3.3 `invalidate(roleId)` e `invalidateAll()`
- [x] 3.4 Invalidación en `PUT /roles/:id/permissions`, `DELETE /roles/:id`, `PATCH /user/:id/role`
- [x] 3.5 Documentado: caché por proceso

## 4. Guard y decoradores

- [x] 4.1 `PERMISSIONS_KEY` en globalConstants
- [x] 4.2 `@RequirePermissions(...)` decorator
- [x] 4.3 `@CurrentUser()` ya existía de `add-user-endpoints`
- [x] 4.4 `PermissionsGuard` con `@Public()` y resolución de usuario contra BD
- [x] 4.5 Denegación por defecto: ruta sin decorador → 403
- [x] 4.6 `@RequirePermissions()` vacío = solo auth; con args = exige todos
- [x] 4.7 Scope resuelto en `request.permissionScope`
- [x] 4.8 Log diferenciando "no permiso" vs "ruta sin decorador"
- [x] 4.9 `PermissionsGuard` como segundo `APP_GUARD` después de `AuthGuard`
- [x] 4.10 `PrismaModule` importado en `AppModule`

## 5. Módulo de roles

- [x] 5.1 `RolesModule` con controller y service
- [x] 5.2 DTOs: create, update, set-permissions
- [x] 5.3 `GET /roles` paginado
- [x] 5.4 `GET /roles/:id` con permisos
- [x] 5.5 `POST /roles` con `role:create`
- [x] 5.6 `PATCH /roles/:id` con `role:update`
- [x] 5.7 `DELETE /roles/:id` con `role:delete`, 409 si tiene usuarios
- [x] 5.8 `PUT /roles/:id/permissions` con `role:update`
- [x] 5.9 `GET /permissions` con `permission:read`

## 6. Protecciones anti-bloqueo

- [x] 6.1 `DELETE` sobre roles `is_system` → 409
- [x] 6.2 Renombrar roles `is_system` → 409
- [x] 6.3 Admin sin `role:update` o `user:assign_role` → 409
- [x] 6.4 Degradar último admin → 409
- [x] 6.5 Se comprueban antes de escribir

## 7. Endpoints de usuario desbloqueados

- [x] 7.1 `GET /user` con `user:read`, paginado, proyección segura
- [x] 7.2 `PATCH /user/:id/role` con `user:assign_role`
- [x] 7.3 `GET /user/me/permissions` funcional para cualquier autenticado
- [x] 7.4 `UserService.users()` expuesto
- [x] 7.5 Invalidación de caché tras cambio de rol

## 8. Decorar handlers existentes

- [x] 8.1 `IncomesController` decorado
- [x] 8.2 `AccountsController` decorado
- [x] 8.3 `TaxesController` decorado
- [x] 8.4 `UserController` decorado (me con auth-only)
- [x] 8.5 `ExpensesController` decorado
- [x] 8.6 `GET /` sigue `@Public()`
- [x] 8.7 Barrido de controllers completo
- [x] 8.8 `CLAUDE.md` creado con documentación de autorización

## 9. Bootstrap del administrador

- [x] 9.1 `AdminBootstrapService` con `ADMIN_EMAIL`
- [x] 9.2 Error en log si no hay admin y no hay `ADMIN_EMAIL`
- [x] 9.3 Script `scripts/bootstrap-admin.ts`
- [x] 9.4 Documentado en CLAUDE.md

## 10. Tests

- [x] Permissions guard logic tested E2E
- [x] Hot revocation verified E2E
- [x] Token invalidation on delete verified E2E
- [x] Anti-lockout protections verified E2E
- [x] TSC and lint pass

## 11. Verificación E2E

- [x] 11.1 API arranca sincronizando catálogo
- [x] 11.2 Admin puede `GET /roles`
- [x] 11.3 Usuario regular: `GET /roles` → 403, `GET /incomes` → 200
- [x] 11.4 Revocación en caliente: 200 → 403 → 200 mismo token
- [x] 11.5 Restauración funciona
- [x] 11.6 `GET /user`: 403 sin `user:read`
- [x] 11.7 `GET /user/me/permissions` funcional
- [x] 11.8 4 protecciones anti-bloqueo → 409
- [x] 11.9 Token de usuario borrado → 401 inmediato
- [x] 11.10 `GET /` público funcional
- [x] 11.11 Lint y build pasan

## 12. Cierre

- [x] 12.1 Spec repasado
- [x] 12.2 Deuda de caché por proceso registrada
- [x] 12.3 Pregunta de último admin borrándose a sí mismo registrada
- [x] 12.4 Scope en BD y guard listo para `add-user-data-scoping`
