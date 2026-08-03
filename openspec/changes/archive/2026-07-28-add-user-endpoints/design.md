## Context

```prisma
model User {
  id              Int      @id @default(autoincrement())
  email           String   @unique
  password        String?
  name            String?
  photo_url       String?
  google_token_id String?
  locale          String   @db.VarChar(3) @default("es")
  created_at      DateTime @default(now())
  @@map("users")
}
```

Estado actual del módulo:

- `UserController` tiene `@Controller('user')` y **cero rutas**.
- `UserService` tiene el CRUD entero ya escrito y sin usar salvo por `auth`.
- `AuthGuard` deja el payload verificado en `request['user']`, con la forma `{ id, email }`.
- `AuthService.signIn` compara `user?.password !== password`: **las contraseñas están en texto plano**.
- `AuthController.signupUser` devuelve directamente el `User` de Prisma. Como Prisma sin `select` devuelve todas las columnas, **la respuesta de `POST /auth/user` incluye `password` en claro**, y el endpoint es `@Public()`.
- `User` no tiene relaciones en el esquema: `Account`, `Income` y `Expense` no llevan `user_id`. Borrar un usuario no arrastra nada.
- No hay modelo de roles ni permisos en ninguna parte del proyecto.

Ese conjunto define el margen de maniobra: se puede dar al usuario control sobre su propio perfil, pero cualquier cosa que implique un usuario mirando a otro no tiene forma de autorizarse.

## Goals / Non-Goals

**Goals:**

- Perfil propio consultable, editable y dado de baja por el usuario autenticado.
- Cerrar la fuga de contraseñas de `POST /auth/user`.
- Establecer, como invariante del sistema y no como cuidado caso por caso, que `password` y `google_token_id` no salen de la API.
- Dejar una forma limpia y reutilizable de saber quién es el usuario de la petición.

**Non-Goals:**

- Hashing de contraseñas. Es urgente, pero es su propio change (ver decisión 3).
- Cambio de contraseña desde el perfil. Bloqueado por lo anterior.
- Listado de usuarios o consulta de perfiles ajenos. Bloqueado por la ausencia de roles.
- Revocación de tokens, refresh tokens, o cualquier cambio en el ciclo de vida del JWT.
- `user_id` en los modelos de dominio.

## Decisions

### 1. Sólo `/me`: el sujeto sale del token, nunca de la petición

Los tres endpoints son `GET`, `PATCH` y `DELETE` sobre `/user/me`. No hay `/user/:id` ni `GET /user`.

*Por qué:* la única regla de autorización que este proyecto puede sostener hoy es "cada usuario sobre sí mismo". Un `GET /user/:id` exigiría decidir quién puede ver a quién, y no hay roles, ni `owner`, ni nada sobre lo que construir esa decisión. Exponerlo sin esa capa significaría que cualquier usuario autenticado enumera a todos los demás — con `UserService.users()` ya escrito, la tentación de cablearlo es real, y por eso queda dicho aquí explícitamente que **no** se conecta.

*Consecuencia de diseño:* el `id` se lee de `request['user'].id`. Ningún handler acepta un identificador de usuario por ruta, query o body. La spec incluye escenarios que verifican que un `?id=2` se ignora y que un `{ "id": 2 }` en el body se rechaza.

### 2. `password` se excluye con `select` de Prisma, no con un serializador

Se aplica un `select` explícito en cada consulta de `User`, listando las columnas públicas: `id`, `email`, `name`, `photo_url`, `locale`, `created_at`.

*Por qué no `@Exclude()` de `class-transformer` con un `ClassSerializerInterceptor`:* ese mecanismo filtra en la capa de salida, lo que significa que el objeto con la contraseña **existe** en memoria y viaja por el service, el controller y cualquier log o mensaje de error por el camino. Basta con que alguien devuelva un objeto plano, use un interceptor distinto o registre el objeto en un log para que se escape. Excluirlo en la consulta significa que la columna no se lee: no hay nada que filtrar porque nunca estuvo ahí.

*Por qué esto importa aquí más de lo normal:* la fuga actual de `POST /auth/user` es exactamente este fallo. `signupUser` devuelve un objeto que nadie pensó que llevara la contraseña. Un serializador lo habría tapado sólo mientras nadie se saltara la capa; el `select` lo hace imposible.

*Excepción:* `AuthService.signIn` necesita leer `password` para compararla. Se le da una consulta propia que la selecciona explícitamente, y el resultado no sale de ese método. Es el único punto del código autorizado a tocar la columna, y conviene que lleve un comentario diciéndolo.

### 3. No hay endpoint de cambio de contraseña, y es deliberado

Es la ausencia más llamativa de este change, así que queda razonada.

Las contraseñas se guardan en claro y se comparan con `!==`. Un endpoint de cambio de contraseña escribiría una contraseña nueva, también en claro, en la misma columna. No empeora el esquema, pero sí amplía la superficie: añade una ruta más por la que circulan credenciales sin cifrar y consolida el diseño actual como si fuera aceptable.

El orden correcto es: primero un change que introduzca hashing (bcrypt o argon2, con migración de las filas existentes y adaptación de `signIn`), y después el cambio de contraseña sobre esa base.

*Alternativa considerada y descartada:* incluir el hashing en este change. Es tentador porque toca los mismos archivos, pero mezcla dos cosas de riesgo muy distinto — endpoints de perfil nuevos y una migración de credenciales que puede dejar a todos los usuarios sin poder entrar si se hace mal. Merecen revisión y rollback independientes.

### 4. Decorador `@CurrentUser()` en vez de `@Req()` en cada handler

Se crea `src/auth/current-user.decorator.ts` con un `createParamDecorator` que devuelve `request.user`.

*Por qué:* la alternativa es `@Req() req` y `req['user'].id` en cada handler, con el casting y el índice de string repetidos. El decorador da un punto único donde tipar el payload (`{ id: number; email: string }`) y donde ajustar la forma si el JWT cambia. Además lo deja disponible para cuando se añada `user_id` a los modelos de dominio, que es cuando todos los módulos van a necesitarlo.

*Nota:* el decorador asume que `AuthGuard` ya ha corrido. En una ruta `@Public()` devolvería `undefined`. No es un problema hoy — no hay rutas públicas que lo usen — pero conviene saberlo antes de combinarlos.

### 5. `locale` se valida contra `['es', 'en']`

La columna es `VARCHAR(3)` con defecto `es`. El frontend tiene exactamente dos ficheros de traducción, `src/Lang/es.ts` y `src/Lang/en.ts`, y `i18n.ts` declara `es` como idioma por defecto y de fallback.

Se valida con `@IsIn(['es', 'en'])`.

*Por qué una lista cerrada y no un `@MaxLength(3)`:* aceptar `fr` porque cabe en la columna crearía un usuario cuya UI cae al fallback sin explicación. Es mejor un `400` que dice qué idiomas hay. El coste es que añadir un idioma exige tocar el DTO además de crear el fichero de traducción — aceptable, y de hecho un recordatorio útil de que hay dos sitios que actualizar.

### 6. Unicidad de email: comprobación previa más `catch` de `P2002`

`email` sí es `@unique` en el esquema, a diferencia de `Tax.name`. La comprobación previa da el `409` con un mensaje claro; el `catch` de `P2002` cubre la carrera.

*Diferencia importante respecto a `add-taxes-crud`:* allí la comprobación en aplicación era la única defensa y, por tanto, no una garantía. Aquí la garantía la da la base de datos y la comprobación previa sólo mejora el mensaje. Es la situación deseable, y conviene notar el contraste: es el argumento para añadir el índice único a `Tax.name` en su momento.

### 7. `DELETE /user/me` borra de verdad, y el token sigue siendo válido después

El borrado es físico. `User` no tiene relaciones, así que no arrastra nada.

Hay una consecuencia que conviene entender: **`AuthGuard` sólo verifica la firma y la caducidad del JWT; nunca comprueba que el usuario siga existiendo**. Tras darse de baja, el token del usuario borrado sigue pasando el guard durante los hasta 7 días que dura su vigencia. `GET /user/me` devolverá `404` porque la fila no está, pero cualquier otro endpoint autenticado — incomes, accounts, expenses — lo aceptará como una petición válida.

Hoy el impacto real es limitado, porque ningún recurso de dominio está scopeado por usuario: ese token no da acceso a nada que no fuera ya visible para cualquier autenticado. Pero en cuanto exista `user_id`, un token de un usuario borrado pasa a ser un problema de verdad.

*No se resuelve aquí* — exigiría o bien una lista de revocación, o bien que el guard consulte la BD en cada petición, y ambas son decisiones de arquitectura de auth que exceden este change. Queda documentado como riesgo y como pregunta abierta.

*Alternativa aplazada:* soft delete (`deleted_at`), que permitiría además que el guard rechazara usuarios dados de baja con una sola columna. Requiere migración.

## Risks / Trade-offs

- **La fuga de contraseñas ya está ocurriendo en producción** → `POST /auth/user` es público y devuelve la contraseña en claro en el cuerpo de la respuesta. Cualquier registro hecho hasta ahora la ha expuesto a logs de servidor, proxies intermedios y al historial del cliente. Este change lo corrige, pero **corregirlo no deshace la exposición pasada**: si hay usuarios reales registrados, sus contraseñas deben considerarse comprometidas y conviene forzar un cambio tras introducir el hashing. Mitigación inmediata: priorizar este change por encima de los demás pendientes.

- **Las contraseñas siguen en texto plano tras este change** → Se cierra el canal de fuga, no la causa. Un volcado de la tabla `users`, un backup mal guardado o un `npx prisma studio` abierto siguen mostrando credenciales legibles. El change de hashing debe ir inmediatamente después; este no debería dar sensación de "problema resuelto".

- **El token de un usuario borrado sigue siendo válido hasta 7 días** → Descrito en la decisión 7. Impacto bajo hoy, alto en cuanto haya `user_id`. Debe resolverse antes o a la vez que ese change.

- **`UserService.users()` queda escrito y sin exponer** → Es una función lista para usar que sólo espera a que alguien la cablee a un `@Get()`. La próxima persona que abra el archivo puede pensar que falta conectarla. Mitigación: comentario en el propio método explicando que no se expone por ausencia de modelo de autorización, con referencia a esta decisión.

- **`@CurrentUser()` devuelve `undefined` en rutas públicas** → No hay ninguna hoy que lo use, pero es un `TypeError` esperando a la primera combinación de `@Public()` con `@CurrentUser()`. Mitigación: documentado en la decisión 4 y en el propio decorador.

- **`PATCH /user/me` con `forbidNonWhitelisted` rechaza campos de sólo lectura con `400`** → Un cliente que reenvíe el objeto de perfil completo tal como lo recibió de `GET /user/me` recibirá un `400` por incluir `id` y `created_at`. Es el comportamiento correcto y está especificado, pero es un error de integración probable con el frontend. Conviene que el mensaje del `400` diga qué campo sobra.

## Migration Plan

Sin migraciones de base de datos.

Orden de despliegue:

1. **Consolidar primero los cambios sin commitear de `src/auth/auth.controller.ts`** — la inyección de `UserService` y el `@Public()` del registro. Este change toca ese mismo archivo.
2. Mergear. `POST /auth/user` deja de devolver la contraseña; los tres endpoints de perfil quedan disponibles.
3. Ningún consumidor existente se rompe: el frontend no llama hoy a ninguna ruta de `/user`, y su login de Google no pasa por `POST /auth/user`.
4. **Inmediatamente después**: abrir el change de hashing de contraseñas. Si hay usuarios reales, forzar renovación de credenciales.

Rollback: revertir el commit reabre la fuga de `POST /auth/user`. Si hay que revertir por otro motivo, conviene conservar al menos el `select` de `signupUser` como parche mínimo.

## Open Questions

- ¿Cómo se invalida el token de un usuario que se da de baja? Lista de revocación, comprobación en el guard, o soft delete con una columna que el guard consulte. Es la pregunta que hay que responder antes de que exista `user_id`.
- ¿Debe `DELETE /user/me` exigir confirmación — reintroducir la contraseña, por ejemplo? Es lo habitual para una acción irreversible, pero con las contraseñas en claro tiene poco valor real. Tiene más sentido plantearlo junto con el hashing.
- Cuando exista un modelo de roles, ¿`GET /user` se expone sólo a administradores, o el listado de usuarios simplemente no forma parte de esta API?
- `google_token_id` se escribe hoy en algún momento del flujo de OAuth? El frontend decodifica el credential en cliente y no llama al backend, así que la columna parece no usarse. Conviene confirmarlo antes de asumir que es dato sensible que proteger o campo muerto que retirar.
