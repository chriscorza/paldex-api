## Context

Hoy la autorización del proyecto es binaria: `AuthGuard` valida la firma del JWT y, si pasa, el usuario puede hacer absolutamente todo. No hay ninguna columna, tabla ni decorador que distinga a un usuario de otro en términos de qué le está permitido.

Estado del código sobre el que se construye:

- `AuthGuard` (`src/auth/auth.guard.ts`) está registrado como `APP_GUARD` global y deja el payload verificado en `request['user']`, con la forma `{ id, email }`.
- `@Public()` (`src/auth/auth.decorator.ts`) usa `IS_PUBLIC_KEY` de `src/globalConstants.ts` y el `Reflector` con `getAllAndOverride`.
- `ValidationPipe` global ya está en `main.ts` con `whitelist`, `forbidNonWhitelisted` y `transform`.
- Módulos implementados: `incomes`, `accounts`, `taxes`. Pendientes: `expenses`, y los endpoints de `user` (`UserController` sigue vacío).
- `ConfigModule` lee `.env.prod`, no `.env` — también en desarrollo.
- `User` no tiene ninguna relación con los modelos de dominio: `Account`, `Income` y `Expense` no llevan `user_id`.

Esa última línea define la frontera de este change: se puede decidir **qué puede hacer** cada usuario, pero todavía no **sobre qué datos**, porque no hay noción de propiedad. El filtrado por propietario es `add-user-data-scoping`.

La elección de modelar roles y permisos en tablas, editables en caliente, en lugar de un enum con permisos codificados, es una decisión tomada explícitamente. Este documento parte de ella y desarrolla sus consecuencias, que no son triviales.

## Goals / Non-Goals

**Goals:**

- Roles y permisos persistidos y reconfigurables sin desplegar.
- Un punto único donde se decide si una petición está autorizada.
- Que olvidar proteger una ruta falle de forma visible, no silenciosa.
- Desbloquear `GET /user` y la administración de usuarios, que llevan bloqueados desde `add-user-endpoints`.
- Que el sistema no pueda quedarse sin forma de administrarse.

**Non-Goals:**

- Filtrar datos por propietario. No hay `user_id` en los modelos de dominio.
- Crear permisos desde la API.
- Varios roles por usuario, jerarquía o herencia entre roles.
- Autorización a nivel de campo o de fila condicional (más allá del `scope` que prepara el change siguiente).
- Auditoría de cambios de permisos.

## Decisions

### 1. Los permisos existen en tablas, pero el catálogo lo gobierna el código

La flexibilidad que aporta modelar esto en base de datos es poder decir "el rol `contable` puede leer ingresos pero no borrarlos" sin tocar código. Lo que **no** aporta es poder inventar permisos nuevos: un permiso que ningún `@RequirePermissions()` comprueba es una fila que no hace nada, y una interfaz que permita crearlo produce la ilusión de haber restringido algo.

Por tanto se parte en dos:

- **`Permission`**: catálogo cerrado, sincronizado al arrancar desde una constante `PERMISSION_CATALOG` en el código. Sin endpoints de escritura.
- **`RolePermission`**: la asignación, editable en caliente por API. Aquí vive toda la flexibilidad.

*Consecuencia:* añadir una capacidad nueva sigue exigiendo un despliegue (la constante y el decorador del handler). Recomponer quién puede hacer qué, no.

*Sobre la sincronización:* da de alta lo que falta y **no borra** lo que sobra. Borrar un permiso que desapareció de la constante arrastraría en cascada sus `RolePermission` y retiraría capacidades a roles existentes como efecto colateral de un refactor. Se registra en el log y se deja la limpieza como decisión manual.

### 2. Los permisos no viajan en el JWT

Es la consecuencia directa e ineludible de haber elegido permisos editables en caliente.

Meterlos en el token elimina la consulta por petición, pero el token dura 7 días: retirarle a alguien el permiso de borrar tardaría hasta una semana en surtir efecto, y no habría forma de forzarlo sin invalidar sesiones. Eso vacía de sentido la decisión de hacerlos editables.

Se resuelven por petición contra la base de datos. La spec lo fija como requisito comprobable: retirar un permiso surte efecto en la siguiente petición, con el mismo token.

*Coste real, medido en consultas:* con la caché de la decisión 6, cada petición hace **una** consulta — un `findUnique` de `users` por clave primaria seleccionando sólo `{ id, role_id }`. Los permisos del rol salen de memoria. Para el volumen de este proyecto es despreciable, y es lo que compra la revocación inmediata.

*Efecto secundario que conviene aprovechar:* como el usuario se resuelve contra la BD en cada petición, un token cuyo usuario ha sido borrado deja de funcionar al instante. Eso cierra la pregunta abierta que dejó `add-user-endpoints` sobre los JWT de usuarios dados de baja, sin necesidad de lista de revocación.

### 3. Un rol por usuario, no N:M

`User.role_id` apunta a un único rol. No hay tabla `UserRole`.

*Por qué, habiendo elegido el modelo flexible:* la flexibilidad pedida está en **qué puede hacer un rol**, y eso se conserva íntegro. Permitir varios roles por usuario añade semántica de unión de permisos, una tabla más, y la pregunta de qué pasa cuando dos roles se contradicen — a cambio de un caso de uso que se resuelve creando un rol que combine ambos conjuntos.

*Extensión futura:* pasar a N:M más adelante es una migración aditiva (crear `user_roles`, backfill desde `role_id`, cambiar la resolución a una unión). No hay nada en este diseño que lo impida.

### 4. Denegación por defecto

Una ruta autenticada sin `@RequirePermissions()` responde `403`.

*Por qué no lo contrario:* con permisividad por defecto, olvidar el decorador en un handler nuevo deja un endpoint abierto y nadie se entera hasta que alguien lo encuentra. Con denegación por defecto, el olvido rompe el endpoint en el primer intento de usarlo, en desarrollo, de forma inmediata y obvia.

*Coste asumido:* en el momento en que este change entra, **todos** los handlers existentes deben llevar su decorador o dejan de funcionar. Las tareas cubren `incomes`, `accounts`, `taxes` y `user`, y marcan `expenses` como condicional. Es trabajo mecánico, y hacerlo de golpe es preferible a descubrirlo endpoint a endpoint.

*Alternativa descartada:* un modo permisivo transitorio configurable por entorno. Un flag que desactiva la autorización es exactamente el flag que acaba activado en producción por accidente.

### 5. El orden de los guards importa y no es evidente

`PermissionsGuard` necesita `request.user`, que lo pone `AuthGuard`. En NestJS, varios `APP_GUARD` se ejecutan **en el orden en que aparecen en el array `providers`** del módulo.

Es decir: en `app.module.ts`, `AuthGuard` debe declararse antes que `PermissionsGuard`. Invertirlos no da error de compilación ni de arranque — simplemente `PermissionsGuard` encuentra `request.user` a `undefined` y todo devuelve `403`, con un síntoma que no apunta a la causa.

Hay un escenario en la spec y una tarea específica para fijarlo, porque es el tipo de detalle que se rompe en un merge y cuesta media tarde diagnosticar.

`PermissionsGuard` también debe respetar `@Public()`, leyendo la misma clave de metadatos con `getAllAndOverride`, o toda ruta pública pasaría a exigir permisos.

### 6. Caché en memoria por rol, invalidada en cada escritura

Un `Map<role_id, Set<string>>` en un provider con ámbito de aplicación. Se puebla en el primer uso de cada rol y se invalida explícitamente en `PUT /roles/:id/permissions`, en `DELETE /roles/:id` y en cualquier `PATCH` que afecte al rol.

*Por qué invalidación explícita y no sólo TTL:* un TTL corto convierte "surte efecto de inmediato" en "surte efecto en menos de N segundos", que es una promesa distinta y peor. La invalidación explícita cumple el requisito literal de la spec. Se puede añadir un TTL largo como red de seguridad, pero no sustituye a la invalidación.

*Limitación que hay que tener presente:* la caché es **por proceso**. Con el `docker-compose.yml` actual hay un único contenedor de API, así que no hay problema. Si algún día se escala a varias instancias, invalidar en una no invalida en las demás, y un permiso retirado seguiría vigente en el resto hasta que caduque su entrada. La solución entonces es caché compartida (Redis) o pub/sub de invalidación. **No se resuelve aquí**, pero queda escrito para que no sorprenda: es la primera cosa que se rompe al escalar horizontalmente.

### 7. `role_id` nullable en el esquema, con backfill dentro de la migración

Añadir una columna FK obligatoria a una tabla con filas exige un valor por defecto o una migración multipaso. Se declara `role_id Int?`.

*Pero nulo no es un estado soportado:* el guard trata "sin rol" como "sin ningún permiso", es decir, `403` en todo. La migración debe dejar a cero usuarios en ese estado.

*Cómo:* generar la migración con `npx prisma migrate dev --create-only` y **editar el SQL a mano** para que, en el mismo fichero de migración, cree los roles de sistema, inserte el catálogo de permisos, y actualice todos los `users` existentes al rol `user`. Un seed posterior y separado deja una ventana en la que la aplicación ya está desplegada y nadie tiene acceso a nada.

*Precisión importante sobre atomicidad:* en MySQL las sentencias DDL provocan un **commit implícito**, así que un fichero de migración que mezcla `CREATE TABLE` con `INSERT` y `UPDATE` **no es atómico**, por mucho que se envuelva en `START TRANSACTION`. Si el `UPDATE` del backfill falla, las tablas ya están creadas y confirmadas, y los usuarios se quedan con `role_id` nulo — es decir, sin acceso a nada. El fallo es seguro pero total. De ahí que la verificación posterior (tarea 1.8) no sea opcional: es la única forma de saber que el backfill corrió.

*Por qué nullable en lugar de un default apuntando a un id fijo:* un `@default(1)` ata el esquema a que el rol 1 sea el correcto, cosa que no se puede garantizar entre entornos. Nullable con fallo cerrado es más honesto: si el backfill no corrió, se nota inmediatamente y de forma segura, en vez de asignar silenciosamente un rol arbitrario.

### 8. `scope` (`OWN` / `ANY`) se incluye ahora aunque no se use todavía

`Permission` lleva `resource`, `action` y `scope`, con `@@unique([resource, action, scope])`. En este change **todos** los permisos del catálogo se emiten con `scope: ANY`, porque sin `user_id` en los modelos de dominio no existe la noción de "propio".

El guard resuelve el scope efectivo del usuario para el permiso exigido y lo deja en la petición, para que los services lo consulten. En este change ese valor siempre es `ANY` y nadie filtra nada.

*Por qué incluirlo ya y no cuando haga falta:* `add-user-data-scoping` es un change acordado, no una hipótesis. Añadir la columna después significa una segunda migración sobre `permissions`, rehacer el `@@unique`, y reemitir el catálogo. El coste de incluirlo ahora son tres líneas de esquema y una constante; el de no hacerlo, una migración evitable.

*Dónde está el límite:* se incluye la columna y la resolución del scope. **No** se implementa ningún filtrado, ni permisos `OWN` en el catálogo, ni lógica condicional en los services. Eso es el change siguiente.

### 9. Protecciones anti-bloqueo, y por qué son tres y no una

Un sistema de permisos editable en caliente puede dejarse inservible con una sola petición mal dada. Las tres vías, y su cierre:

1. **Borrar el rol administrador** → los roles con `is_system` no se borran ni se renombran.
2. **Vaciar los permisos del administrador** → `PUT /roles/<admin>/permissions` rechaza cualquier conjunto que no incluya `role:update` y `user:assign_role`. Son exactamente los dos permisos que permiten deshacer el error.
3. **Quitarle el rol al último administrador** → `PATCH /user/:id/role` rechaza el cambio si dejaría cero usuarios con rol administrador.

*Por qué las tres:* cerrar sólo una o dos deja el bloqueo alcanzable por otra vía, y la recuperación en todos los casos pasa por tocar la base de datos a mano. Son baratas de implementar y cada una tiene su escenario en la spec.

*Lo que no se cierra:* borrar el último usuario administrador mediante `DELETE /user/me`. Es alcanzable y queda como pregunta abierta — cerrarlo exige tocar un endpoint que pertenece a `add-user-endpoints`.

### 10. Bootstrap del primer administrador: explícito, no mágico

La migración deja a todos los usuarios con rol `user`. Alguien tiene que ser `admin`.

- Si `ADMIN_EMAIL` está definido en `.env.prod`, al arrancar se promueve a ese usuario de forma idempotente.
- Si no, se registra un error claro en el log y se ofrece un script manual: `npm run bootstrap:admin -- <email>`.

*Por qué no promover automáticamente al usuario de menor id:* es una heurística que acierta en desarrollo y falla en producción, donde el primer registro puede ser una cuenta de prueba. Un sistema sin administrador es un problema visible y arreglable en un minuto; un administrador inesperado es un problema silencioso.

*Recordatorio de entorno:* la variable va en `.env.prod`, porque es el fichero que `ConfigModule` carga incluso en desarrollo.

### 11. Formato del permiso: `resource:action`

El decorador recibe cadenas como `'income:read'` o `'role:update'`. El scope no forma parte de la cadena que declara el handler: el handler dice qué operación es, y el guard determina con qué alcance la tiene concedida el usuario.

Recursos: `income`, `expense`, `account`, `tax`, `user`, `role`, `permission`. Acciones: `read`, `create`, `update`, `delete`, más `user:assign_role` como caso específico.

*Por qué una cadena y no dos argumentos:* es más legible en el sitio donde se lee (`@RequirePermissions('income:create')`), y una constante tipada derivada del catálogo evita las erratas que el formato libre invitaría.

## Risks / Trade-offs

- **Una consulta a base de datos por petición** → Es el precio de la revocación inmediata, y es consecuencia directa de haber elegido permisos editables en caliente en lugar de un enum en el token. Con la caché por rol se queda en un `findUnique` por PK seleccionando dos columnas. Mitigación real si algún día molesta: cachear también `user_id → role_id` con TTL corto, aceptando a cambio que un usuario borrado siga entrando durante ese TTL.

- **La caché es por proceso** → Descrito en la decisión 6. Correcto con un solo contenedor, incorrecto en cuanto haya dos. Es la primera pieza que hay que rehacer al escalar, y conviene que quien lo haga lo sepa antes de escalar, no después.

- **La denegación por defecto rompe todo lo no decorado** → Al desplegar, cualquier handler sin decorador devuelve `403`. Las tareas cubren los módulos existentes, pero si `add-expenses-crud` se implementa **después** de este change y su autor no lee esto, entregará un módulo entero que devuelve `403` y parecerá un bug del sistema de permisos. Mitigación: tarea explícita de dejarlo anotado en `CLAUDE.md`, que es lo que se lee al empezar cualquier trabajo en el repo.

- **La migración puede dejar a todo el mundo sin acceso** → Si el backfill no corre, todos los usuarios quedan con `role_id` nulo y el sistema deniega todo. El fallo es seguro (cerrado) pero total. Mitigación: el backfill va dentro del SQL de la migración, en la misma transacción que la creación de las tablas, y hay una tarea de verificación en un volcado de datos reales antes de aplicarlo en producción.

- **Complejidad frente al tamaño del proyecto** → Tres tablas, un guard, un decorador, un servicio de sincronización, una caché con invalidación y un CRUD de administración, para una aplicación de finanzas personales con un puñado de usuarios. Un enum `Role` con los permisos codificados habría cubierto el caso práctico con una fracción del código y sin consultas por petición. La configurabilidad en caliente es una decisión tomada a conciencia; el coste que compra es este, y se materializa sobre todo en superficie que mantener y en la caché, que es la pieza con más formas sutiles de fallar.

- **Sin auditoría de cambios de permisos** → No queda registro de quién concedió qué ni cuándo. En un sistema donde los permisos se editan en caliente, eso es justo lo que se echa de menos al investigar un incidente. No entra aquí; conviene tenerlo presente si el número de administradores pasa de uno.

- **El `403` no distingue "no tienes permiso" de "la ruta no está protegida"** → Ambos casos responden lo mismo, que es lo correcto de cara al cliente pero incómodo al depurar. Mitigación: que el guard registre en el log, en desarrollo, cuál de los dos motivos fue.

## Migration Plan

**Este change migra el esquema.** Es el primero de todos los propuestos que lo hace.

1. Añadir `Role`, `Permission`, `RolePermission`, el enum `PermissionScope` y `User.role_id` a `prisma/schema.prisma`.
2. `npx prisma migrate dev --create-only` para generar el SQL sin aplicarlo.
3. **Editar el SQL a mano** y añadir, tras las sentencias DDL y en este orden (el DDL confirma por su cuenta, ver decisión 7):
   - alta de los roles de sistema `admin` y `user` con `is_system = true`;
   - alta del catálogo de permisos;
   - concesión de todos los permisos al rol `admin`;
   - concesión del subconjunto operativo al rol `user`;
   - `UPDATE users SET role_id = <id de user> WHERE role_id IS NULL`.
4. Aplicar y verificar que no queda ningún usuario con `role_id` nulo.
5. Definir `ADMIN_EMAIL` en `.env.prod` y arrancar, o ejecutar `npm run bootstrap:admin -- <email>`.
6. Verificar que ese usuario puede administrar roles antes de dar el despliegue por bueno.

**Rollback**: revertir la migración devuelve el sistema al estado sin autorización, en el que todo usuario autenticado puede todo. Es un rollback seguro en cuanto a disponibilidad y permisivo en cuanto a seguridad — conviene no dejarlo a medias.

**Orden respecto a otros changes**: no depende de `add-expenses-crud` ni de `add-user-endpoints`, pero se solapa con ambos. Si `add-user-endpoints` no está implementado, este change crea `@CurrentUser()` y los primeros handlers de `UserController`; si ya lo está, los reutiliza. Las tareas lo marcan como condicional.

## Open Questions

- `DELETE /user/me` permite que el último administrador se borre a sí mismo y deje el sistema sin administración. Cerrarlo exige tocar un endpoint de `add-user-endpoints`. ¿Se añade la comprobación allí, o se traslada aquí la propiedad de ese handler?
- ¿Debe `GET /user/me` incluir el rol y los permisos, en lugar de obligar a una segunda llamada a `GET /user/me/permissions`? Ahorraría un viaje en el arranque del frontend, a cambio de mezclar perfil y autorización en una misma respuesta.
- ¿Hace falta auditar los cambios de permisos? Con un solo administrador, no. Con varios, es lo primero que se echa en falta.
- Cuando llegue `add-user-data-scoping`, ¿los permisos `OWN` y `ANY` conviven en el mismo rol, o un rol tiene uno u otro para cada recurso? El `@@unique([resource, action, scope])` permite ambos; la resolución debe decidir que `ANY` prevalece sobre `OWN`.
