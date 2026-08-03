## 1. Gate previo

- [x] 1.1 Consolidar (commitear o descartar) los cambios pendientes de `src/auth/auth.controller.ts` — la inyección de `UserService` y el `@Public()` del registro. Este change toca ese mismo archivo
- [x] 1.2 Confirmar que el `ValidationPipe` global está registrado en `src/main.ts` (lo introduce `add-incomes-crud`); sin `forbidNonWhitelisted` los escenarios de campos rechazados no se cumplen
- [x] 1.3 Reproducir la fuga antes de arreglarla: `POST /auth/user` con un usuario de prueba y comprobar que la respuesta incluye `password` en claro. Guardar la evidencia para verificar después que desaparece

## 2. Proyección segura de usuario

- [x] 2.1 Definir en `src/user/entities/user.entity.ts` la proyección pública: `id`, `email`, `name`, `photo_url`, `locale`, `created_at`. Es la única forma de un usuario que puede salir de la API
- [x] 2.2 Definir un objeto `select` reutilizable con esas columnas, para pasarlo a todas las consultas de `User`
- [x] 2.3 Aplicar el `select` a `UserService.user()`, `userByEmail()`, `users()`, `createUser()`, `updateUser()` y `deleteUser()` — todos salvo la consulta dedicada del login (design §2)
- [x] 2.4 Añadir en `AuthService.signIn` una consulta propia que sí seleccione `password`, con un comentario indicando que es el único punto autorizado a leer esa columna, y verificar que el valor no sale del método
- [x] 2.5 Verificar que `POST /auth/user` ya no devuelve `password` ni `google_token_id`, contrastando con la evidencia de la tarea 1.3
- [x] 2.6 Añadir un comentario en `UserService.users()` explicando que no se expone por ausencia de modelo de autorización (design §1, §Riesgos)

## 3. Decorador @CurrentUser

- [x] 3.1 Crear `src/auth/current-user.decorator.ts` con un `createParamDecorator` que devuelva `request.user`, tipado como `{ id: number; email: string }` — la forma exacta del payload que firma `AuthService.signIn`
- [x] 3.2 Documentar en el propio archivo que el decorador depende de que `AuthGuard` haya corrido, y que en una ruta `@Public()` devolvería `undefined` (design §4)

## 4. DTO de actualización

- [x] 4.1 Crear `src/user/dto/update-user.dto.ts` con **sólo** los campos editables: `email?` (`@IsOptional`, `@IsEmail`), `name?` (`@IsOptional`, `@IsString`), `photo_url?` (`@IsOptional`, `@IsString`), `locale?` (`@IsOptional`, `@IsIn(['es','en'])`)
- [x] 4.2 Confirmar que `id`, `password`, `google_token_id` y `created_at` **no** están en el DTO — el `forbidNonWhitelisted` del pipe global es lo que los convierte en `400`
- [x] 4.3 No usar `PartialType` sobre un DTO de creación que incluya `password`: heredaría el campo y abriría por la puerta de atrás lo que la decisión §3 del design excluye a propósito

## 5. Service: perfil propio

- [x] 5.1 Implementar `findMe(userId)`: `findUnique` con el `select` público, lanzando `NotFoundException` si el usuario del token ya no existe
- [x] 5.2 Implementar `updateMe(userId, dto)`: verificar existencia (`404`), comprobar unicidad del email si viene y difiere del actual, y escribir con el `select` público
- [x] 5.3 En la comprobación de unicidad, no tratar el email propio como conflicto consigo mismo
- [x] 5.4 Envolver la escritura en un `catch` de `P2002` traducido a `ConflictException`, como red de seguridad frente a la carrera (design §6)
- [x] 5.5 Implementar `removeMe(userId)`: verificar existencia (`404`) y borrar

## 6. Controller

- [x] 6.1 Añadir los handlers a `src/user/user.controller.ts`, que hoy está vacío. **Sin `@Public()`**
- [x] 6.2 `@Get('me')` → `findMe(@CurrentUser() user)` delegando con `user.id`
- [x] 6.3 `@Patch('me')` → `updateMe(@CurrentUser() user, @Body() dto: UpdateUserDto)`
- [x] 6.4 `@Delete('me')` → `removeMe(@CurrentUser() user)`
- [x] 6.5 Verificar que ningún handler acepta un id de usuario por ruta, query o body — el sujeto sale siempre del token (design §1)
- [x] 6.6 **No** añadir `@Get()` ni `@Get(':id')`, aunque `UserService.users()` esté disponible

## 7. Tests

- [x] 7.1 Crear `src/user/user.service.spec.ts` con un mock de `PrismaService`
- [x] 7.2 **Test central de seguridad**: verificar que toda consulta de `User` lleva el `select` público y que `password` no está entre las columnas pedidas, en `findMe`, `updateMe` y `removeMe`
- [x] 7.3 Verificar que la respuesta de los tres métodos no contiene las claves `password` ni `google_token_id`
- [x] 7.4 Cubrir la unicidad de email y catch P2002
- [x] 7.5 Cubrir `404`
- [x] 7.6 Crear `src/user/user.controller.spec.ts`
- [x] 7.7 Añadir test en auth controller spec verificando que signup no devuelve password
- [x] 7.8 Actualizar auth service spec con PrismaService y tests de login
- [x] 7.9 20 tests en verde (`src/user src/auth`)

## 8. Verificación end-to-end

- [x] 8.1 `GET /user/me` sin token → `401`
- [x] 8.2 `POST /auth/user` ya no devuelve `password` ni `google_token_id`
- [x] 8.3 `GET /user/me` devuelve keys seguras
- [x] 8.4 `PATCH /user/me` funciona con name y locale
- [x] 8.5 `password`, `id`, `google_token_id` → `400`
- [x] 8.6 Email duplicado → `409`
- [x] 8.7 `DELETE /user/me` → `200`, luego `404`
- [x] 8.8 Token de usuario borrado sigue pasando AuthGuard (riesgo documentado)
- [x] 8.9 Lint y build

## 9. Cierre

- [x] 9.1 Spec repasado escenario a escenario
- [x] 9.2 Deuda de hashing registrada — las contraseñas siguen en texto plano aunque la fuga esté cerrada
- [x] 9.3 Si hay usuarios reales registrados antes de este arreglo, sus contraseñas deben considerarse comprometidas
- [x] 9.4 Pregunta abierta de invalidación de tokens tras baja registrada
