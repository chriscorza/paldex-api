## Why

El proyecto no tiene ningún modelo de autorización. `AuthGuard` responde a una única pregunta — "¿este token es válido?" — y a partir de ahí todo usuario autenticado puede hacer todo: crear cuentas, borrar impuestos, modificar los ingresos de cualquiera. Esa ausencia ya está bloqueando trabajo concreto:

- `UserService.users()` lleva escrito desde el commit inicial y `add-user-endpoints` decidió **no** exponerlo, porque sin roles cualquier usuario podría enumerar a todos los demás.
- `add-user-endpoints` tuvo que limitarse a `/user/me` por el mismo motivo: no hay forma de decidir quién puede ver a quién.
- El catálogo de impuestos de `add-taxes-crud` es común a todo el mundo y hoy cualquiera puede reescribirlo.

Este change introduce la capa que faltaba: roles y permisos persistidos en base de datos y editables en caliente, con un guard que los aplica.

## What Changes

- **Nuevos modelos Prisma**: `Role`, `Permission`, `RolePermission` (N:M) y una columna `role_id` en `User`. **Requiere migración.**
- **Catálogo de permisos gobernado desde el código**: las filas de `Permission` se sincronizan al arrancar desde una constante `PERMISSION_CATALOG`. Lo editable en caliente es **qué permisos tiene cada rol**, no qué permisos existen — un permiso que ningún `@RequirePermissions` comprueba no significa nada.
- **Dimensión `scope` en los permisos** (`OWN` / `ANY`) desde el primer día, aunque en este change todos los permisos se emitan como `ANY`. La usa `add-user-data-scoping`; incluirla ahora evita una segunda migración sobre la misma tabla.
- **`PermissionsGuard` global**, registrado después de `AuthGuard`, que resuelve los permisos del usuario contra la base de datos en cada petición.
- **Denegación por defecto**: una ruta autenticada sin `@RequirePermissions()` responde `403`. Olvidar un decorador falla de forma ruidosa, no deja un agujero silencioso.
- **Decorador `@RequirePermissions('income:read', ...)`** para declarar lo que exige cada handler.
- **Caché en memoria de los permisos por rol**, invalidada al escribir en `Role` o `RolePermission`, para no consultar la BD en cada petición.
- **Endpoints de administración**: CRUD de `/roles`, `PUT /roles/:id/permissions` para fijar el conjunto de permisos de un rol, y `GET /permissions` como catálogo de sólo lectura.
- **Desbloqueo de `GET /user`** y de `PATCH /user/:id/role`, ahora que existe con qué protegerlos.
- **`GET /user/me/permissions`**, para que el frontend pueda ocultar lo que el usuario no puede hacer.
- **Protecciones anti-bloqueo**: los roles de sistema no se borran ni se renombran, al rol `admin` no se le pueden retirar los permisos que permiten arreglarlo, y no se puede dejar el sistema sin ningún administrador.
- **Todos los handlers existentes pasan a llevar su decorador de permisos** — `incomes`, `accounts`, `user`, y `taxes`/`expenses` si ya están implementados.

### No incluido (non-goals)

- **No se filtran datos por propietario.** `GET /incomes` sigue devolviendo los ingresos de todos: los modelos de dominio no tienen `user_id`. Eso es `add-user-data-scoping`, el change siguiente del plan acordado. Este introduce el *quién puede*, no el *sobre qué*.
- No se permite crear permisos nuevos por API.
- No se soportan varios roles por usuario: `User.role_id` es uno solo. Ver la decisión 3 del `design.md`.
- No hay jerarquía ni herencia entre roles.
- No se toca el hashing de contraseñas ni el ciclo de vida del JWT.

## Capabilities

### New Capabilities
- `roles-permissions`: definición y administración de roles, catálogo de permisos, asignación de rol a usuario, y la comprobación de autorización que aplica todo eso a cada petición.

### Modified Capabilities

Ninguna en `openspec/specs/` todavía. Los deltas sobre `incomes-crud`, `accounts-crud` y `user-profile` se limitan a añadir el requisito de permiso a endpoints ya especificados, y se recogen en la capability nueva para no fragmentar la regla de autorización en cuatro sitios.

## Impact

**Base de datos** — **este change sí migra**:
- Nuevas tablas `roles`, `permissions`, `role_permissions`.
- Nueva columna `users.role_id` (nullable en el esquema, ver `design.md`).
- **Backfill obligatorio en la propia migración**: sin él, todos los usuarios existentes se quedan sin rol y, por la denegación por defecto, sin acceso a nada.

**Código nuevo**
- `src/roles/` — module, controller, service, dto, entities
- `src/permissions/` — catálogo, servicio de sincronización y de resolución, caché
- `src/auth/permissions.guard.ts`, `src/auth/permissions.decorator.ts`
- `src/auth/current-user.decorator.ts` — si `add-user-endpoints` no lo ha creado ya

**Código modificado**
- `src/app.module.ts` — registrar los módulos nuevos y el segundo `APP_GUARD`, **en orden**.
- `src/globalConstants.ts` — clave de metadatos de permisos.
- `src/user/user.controller.ts` y `user.service.ts` — `GET /user`, `PATCH /user/:id/role`, `GET /user/me/permissions`.
- Todos los controllers existentes — un decorador por handler.
- `prisma/schema.prisma`.

**Efecto secundario relevante**: como el guard resuelve el usuario contra la base de datos en cada petición, un token de un usuario borrado deja de funcionar de inmediato. Eso cierra la pregunta abierta que dejó `add-user-endpoints` sobre los JWT de usuarios dados de baja.

**Dependencias**: ninguna nueva.
