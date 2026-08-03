## Why

`UserController` (`src/user/user.controller.ts`) está declarado con `@Controller('user')` y **no expone ni una ruta**, mientras que `UserService` ya tiene el CRUD completo implementado (`user`, `userByEmail`, `users`, `createUser`, `updateUser`, `deleteUser`). Un usuario autenticado no puede consultar ni editar su propio perfil: ni cambiar su nombre, ni su idioma, ni su foto.

Al mapear el módulo aparece además un problema en producción hoy mismo: **`POST /auth/user` devuelve la fila completa del usuario recién creado, incluida la columna `password`**. `AuthController.signupUser` retorna directamente lo que devuelve `UserService.createUser`, que es un `User` de Prisma sin filtrar. Como `AuthService.signIn` compara contraseñas sin hashear, ese campo es la contraseña en texto plano, y el endpoint es `@Public()`. Cualquiera que se registre recibe su propia contraseña de vuelta en el cuerpo de la respuesta, donde queda en logs, proxies y en el historial del navegador.

## What Changes

- **Endpoints de perfil propio** en el `UserController` vacío: `GET /user/me`, `PATCH /user/me`, `DELETE /user/me`. Todos autenticados, todos resueltos contra el `id` del JWT.
- **`password` deja de salir de la API por cualquier vía.** Se aplica un `select` explícito de Prisma en todas las lecturas y escrituras de `User`, de modo que la columna nunca llega a materializarse en un objeto que se pueda serializar por accidente.
- **Corrección de la fuga en `POST /auth/user`**: el endpoint pasa a devolver la misma proyección segura que el resto, sin `password` ni `google_token_id`.
- **Nuevo decorador `@CurrentUser()`** (`src/auth/current-user.decorator.ts`) que extrae el payload que el `AuthGuard` ya deja en `request['user']`, para no repetir `@Req()` y castings en cada handler.
- **Validación de `locale`** contra los idiomas que el frontend soporta (`es`, `en`), respetando el `@db.VarChar(3)` del esquema.
- **Cambio de email con control de unicidad**: `409 Conflict` si el email ya pertenece a otro usuario, en vez de dejar escapar el `P2002` de Prisma como un `500`.

### No incluido (non-goals)

- **No se implementa cambio de contraseña.** Sería el complemento natural, pero las contraseñas se guardan y comparan en texto plano (`AuthService.signIn` hace `user?.password !== password`). Añadir un endpoint que escriba contraseñas nuevas en claro amplía una vulnerabilidad existente en lugar de contenerla. Debe ir **después** de un change que introduzca hashing — ver `design.md`.
- **No se implementa `GET /user` (listado de usuarios).** El `UserService.users()` existe, pero no hay modelo de roles ni permisos en el proyecto: cualquier usuario autenticado podría listar a todos los demás. Sin autorización, el endpoint no se puede exponer de forma responsable.
- **No se implementa `GET /user/:id`.** Mismo motivo: sin roles no hay forma de decidir quién puede ver a quién.
- No se añade hashing de contraseñas, ni revocación de tokens, ni `user_id` a los modelos de dominio.
- No se toca el flujo de Google OAuth del frontend.

## Capabilities

### New Capabilities
- `user-profile`: consulta, edición y baja del perfil propio del usuario autenticado, y la regla transversal de que la contraseña y el identificador de token de Google nunca forman parte de ninguna respuesta de la API.

### Modified Capabilities

Ninguna en `openspec/specs/` (está vacío). La corrección de `POST /auth/user` queda cubierta por el requisito de proyección segura de `user-profile`, que aplica a toda respuesta que represente un usuario, venga del módulo que venga.

## Impact

**Código nuevo (`paldex-api`)**
- `src/auth/current-user.decorator.ts`
- `src/user/dto/update-user.dto.ts`
- `src/user/entities/user.entity.ts` — la proyección pública del usuario
- `src/user/user.controller.spec.ts`, `src/user/user.service.spec.ts`

**Código modificado**
- `src/user/user.controller.ts` — de cero rutas a tres.
- `src/user/user.service.ts` — `select` explícito en todos los métodos; nuevos `findMe`, `updateMe`, `removeMe`.
- `src/auth/auth.controller.ts` — `signupUser` deja de devolver la fila cruda. **Ojo**: este archivo tiene cambios sin commitear (la inyección de `UserService` y el `@Public()` del registro); conviene consolidarlos antes de tocarlo.
- `src/auth/auth.service.ts` — `signIn` necesita seguir leyendo `password` para comparar, así que usa una consulta propia que sí lo selecciona. Es el único punto del código autorizado a leer esa columna.

**Seguridad**: cierra una fuga activa de contraseñas en texto plano. No resuelve la causa raíz — que existan en texto plano — que sigue abierta.

**Dependencias**: ninguna nueva.

**Base de datos**: sin migraciones.
