## Context

Este es el segundo change del plan de dos acordado. `add-roles-permissions` responde a "qué puede hacer este usuario"; éste responde a "sobre qué datos".

Estado sobre el que se construye:

- `add-incomes-crud`, `add-accounts-crud`, `add-taxes-crud` y `add-expenses-crud` están implementados. Existen `src/common/filters/` con los helpers de filtrado compartidos, y los cuatro services hablan con Prisma directamente.
- `add-roles-permissions` aporta la columna `Permission.scope` (`OWN` / `ANY`), el `PermissionsGuard` y el scope resuelto en la petición. En ese change **todos** los permisos se emiten como `ANY` y nada filtra.
- Ningún modelo de dominio tiene `user_id`. `Account`, `Income` y `Expense` no conocen a su dueño.
- La base de datos tiene datos reales de desarrollo, creados sin noción de propiedad.

El riesgo dominante de este change es de una clase distinta a los anteriores: aquí un olvido no produce un error visible, produce una **fuga silenciosa de datos entre usuarios**. Una consulta a la que se le olvida el filtro de propietario funciona perfectamente y devuelve de más. Ese hecho ordena casi todas las decisiones que siguen.

## Goals / Non-Goals

**Goals:**

- Que cada usuario vea y manipule únicamente sus cuentas y movimientos.
- Que un administrador con scope `ANY` pueda verlo todo, sin código especial en cada service.
- Que la existencia de datos ajenos no sea deducible desde la API.
- Que la migración adjudique los datos existentes sin perder ni una fila.
- Que olvidar el filtro en una consulta nueva sea detectable, no invisible.

**Non-Goals:**

- Compartir datos entre usuarios: espacios comunes, invitaciones, cuentas conjuntas.
- `user_id` en `Tax`.
- Cambios en la forma de las respuestas.
- Resolver la deriva de `Account.balance` ni migrar los `Float` a `Decimal`.

## Decisions

### 1. El contexto de propiedad viaja explícito, no por magia

Cada método de service que lee o escribe recursos con dueño recibe un `OwnershipContext` — `{ userId, scope }` — como argumento. El controller lo compone a partir de `@CurrentUser()` y del scope que el guard dejó resuelto en la petición.

*Alternativas consideradas, y por qué no:*

- **Providers con ámbito de petición** (`Scope.REQUEST`): Nest instancia el service por petición, lo que contagia el ámbito a todo lo que lo inyecte y tiene coste real. Además convierte los tests en un ejercicio de montar contextos de petición.
- **`AsyncLocalStorage`**: elimina el parámetro, a cambio de que la procedencia del `userId` sea invisible en la firma. Funciona hasta que algo corre fuera del contexto — una tarea programada, un `$transaction` con callback, un handler de arranque — y entonces el filtro desaparece sin avisar. Es exactamente el modo de fallo que este change no se puede permitir.
- **Extensión de cliente de Prisma (`$extends`)** que inyecte `user_id` en toda consulta: es la única opción que hace imposible el olvido, pero necesita el usuario actual, que es información de petición, así que arrastra `AsyncLocalStorage` con todos sus problemas. Además interfiere con agregados y con las consultas legítimamente globales, como las del propio módulo de permisos.

*Lo explícito es más verboso y sigue siendo olvidable.* Por eso no basta por sí solo: la decisión 2 es la que lo hace verificable.

### 2. Un helper único de filtro de propiedad, y tests que exigen su presencia

Se añade a `src/common/filters/` un `buildOwnerFilter(ctx)` que devuelve `{}` cuando el scope es `ANY` y `{ user_id: ctx.userId }` cuando es `OWN`. Todos los `where` de los tres módulos lo componen.

Y, más importante: **cada suite de service incorpora un test que recorre todos sus métodos de lectura y escritura y afirma que, con scope `OWN`, la consulta enviada a Prisma lleva `user_id` en el `where`.** No un test por método escrito a mano — un test que enumera los métodos, de forma que añadir uno nuevo sin filtro haga fallar la suite.

*Por qué esto y no confiar en la revisión:* la revisión detecta lo que está mal escrito; no detecta lo que falta. Un método nuevo sin filtro de propietario pasa cualquier lectura de código porque no hay nada anómalo que ver — sencillamente falta una línea.

### 3. Un recurso ajeno responde `404`, nunca `403`

Pedir, editar o borrar algo de otro usuario devuelve exactamente la misma respuesta que pedir algo inexistente.

*Por qué:* un `403` confirma que el recurso existe. Recorriendo ids se puede reconstruir cuántos movimientos tiene el sistema y en qué rangos de id, que es justo lo que el aislamiento pretende impedir. Con `404` uniforme, un id ajeno y un id inexistente son indistinguibles.

*Matiz:* esto vale para el scope `OWN`. Con `ANY` no hay nada que ocultar y el `404` sólo aparece cuando el recurso realmente no existe.

### 4. `findFirst` con el filtro compuesto, no `findUnique` seguido de comprobación

Las lecturas por id pasan de `findUnique({ where: { id } })` más una comprobación posterior del dueño, a `findFirst({ where: { id, ...ownerFilter } })`.

*Por qué:* `findUnique` sólo admite campos únicos en el `where`, así que no puede llevar `user_id`. La alternativa sería leer y comparar después, lo que deja el objeto ajeno cargado en memoria y a un `return` de distancia de escaparse. Con `findFirst`, el resultado es `null` tanto si no existe como si no es del usuario — que es precisamente el comportamiento indistinguible que exige la decisión 3, sin código adicional para conseguirlo.

Lo mismo aplica a `update` y `delete`: primero un `findFirst` con el filtro compuesto para decidir el `404`, y sólo entonces la escritura por id.

### 5. `ANY` prevalece sobre `OWN`

Un rol puede tener concedido `income:read` en ambos scopes. En ese caso se aplica `ANY`.

*Por qué:* los permisos son aditivos por naturaleza — conceder más no debería restringir. La regla contraria haría que añadir `income:read:OWN` a un administrador le quitara visibilidad, que es un comportamiento que nadie espera.

Esto responde a la pregunta abierta que dejó `add-roles-permissions`.

### 6. `Tax` no tiene dueño

El catálogo de impuestos sigue siendo común a la instalación, administrado por permisos (`tax:create` y compañía) y no por propiedad.

*Por qué:* el IVA al 21 % es el mismo para todos los usuarios de una misma jurisdicción. Duplicar el catálogo por usuario multiplica filas idénticas, obliga a que cada alta recree los mismos impuestos, y rompe la protección de borrado de `add-taxes-crud` de una forma incómoda. Un usuario que necesite un impuesto propio es un caso que no se ha planteado.

*Consecuencia visible:* al crear un income con `tax_ids`, se valida que los impuestos existan, pero **no** a quién pertenecen — no pertenecen a nadie. La spec lo fija explícitamente para que no se implemente una comprobación de propiedad que no tiene sentido.

### 7. Las referencias cruzadas se validan contra el dueño

La validación de FK que ya existe (`account_id` existe) pasa a ser: `account_id` existe **y**, con scope `OWN`, pertenece al usuario. Responde `400`, no `404`, porque el recurso problemático es un argumento del cuerpo, no el recurso al que se dirige la petición.

Sin esto, el aislamiento tiene un agujero evidente: bastaría crear un income apuntando a la cuenta de otro para escribir en su contabilidad.

### 8. Los contadores se calculan con `_count` filtrado

`GET /accounts/:id` devuelve `incomes_count` y `expenses_count`. Con propiedad, esos números deben contar sólo lo visible para quien pregunta.

Prisma admite filtrar los recuentos de relación: `_count: { select: { Income: { where: ownerFilter } } }`. Se usa eso en lugar de un recuento aparte.

*Recordatorio del esquema:* en `Account` los campos de relación están **capitalizados** (`Income`, `Expense`), a diferencia de `Tax`, donde van en minúscula. Es el mismo footgun documentado en `add-accounts-crud`.

*Coherencia que hay que mantener:* la protección de borrado de cuentas (`409` si tiene movimientos) debe contar con el mismo criterio que el detalle. Si el detalle dice "0 movimientos" y el borrado responde `409`, el usuario ve un sistema que se contradice. Con scope `OWN` sobre una cuenta propia ambos números coinciden, pero conviene que sea por construcción y no por casualidad.

### 9. La migración: nullable, backfill, y sólo después `NOT NULL`

En MySQL no se puede añadir una columna `NOT NULL` con clave ajena a una tabla con filas sin dar un valor. La secuencia es:

1. `ALTER TABLE ... ADD COLUMN user_id INT NULL`
2. `UPDATE ... SET user_id = <id del adjudicatario>`
3. `ALTER TABLE ... MODIFY user_id INT NOT NULL`
4. `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY`

**Nada de esto es atómico.** Las sentencias DDL de MySQL provocan un commit implícito, así que envolver el fichero en una transacción no sirve de nada: si el paso 2 falla, el paso 1 ya está confirmado. Por eso las precondiciones se comprueban **antes** del paso 1, y hay una verificación explícita después del paso 4.

*A quién se adjudican las filas existentes:* al usuario administrador establecido por `add-roles-permissions` (el de `ADMIN_EMAIL`). Es el único candidato defendible: los datos actuales los creó quien está desarrollando, y esa es la cuenta que tiene. Si no hay un administrador único e inequívoco, la migración se detiene antes de tocar nada — adivinar el dueño de datos financieros es peor que no migrar.

*Antes de aplicar en producción:* copia de seguridad. Es la primera migración del proyecto que reescribe filas existentes en lugar de sólo añadir estructura.

### 10. Este change no cambia la forma de las respuestas, sólo su contenido

`GET /incomes` sigue devolviendo `{ data, total, page, limit }`. Lo que cambia es cuántas filas trae y qué cuenta `total`.

*Por qué merece decirse:* no hay nada que adaptar en el cliente, pero un usuario que antes veía 40 movimientos pasará a ver 3 sin que nada indique por qué. Si hay datos de más de una persona mezclados en desarrollo, va a parecer una pérdida de datos. Conviene avisar antes de desplegar, no después.

## Risks / Trade-offs

- **Un filtro olvidado es una fuga silenciosa, no un error** → Es el riesgo central. Una consulta sin `user_id` devuelve datos ajenos y no falla, no avisa y no aparece en ningún log. Mitigación en tres capas: el helper único (decisión 2), los tests que enumeran métodos y exigen el filtro, y una verificación end-to-end con dos usuarios reales y datos cruzados. Ninguna de las tres sobra.

- **La migración reescribe datos reales y no puede deshacerse sola** → Adjudicar todas las filas al administrador es correcto en el escenario esperado (un solo desarrollador con sus datos), pero si la base de datos tuviera datos de dos personas mezclados, este change los concentra bajo un único dueño y no hay forma automática de separarlos después. Mitigación: copia de seguridad previa y una tarea de inspección de los datos existentes antes de escribir el SQL.

- **`ANY` no distingue "administrar" de "leer los movimientos de otro"** → Un administrador con `income:read:ANY` ve las finanzas personales de todos los usuarios. Para un producto de finanzas personales eso es una concentración de privilegio considerable, y no hay auditoría que registre cuándo se ejerce. La alternativa — que ni siquiera el administrador pueda ver datos ajenos — dejaría sin solución el soporte y la depuración. Es una decisión de producto más que técnica, y conviene tomarla a conciencia antes de que haya usuarios que no sean el propio equipo.

- **Cada `findOne`, `update` y `remove` pasa a hacer una consulta previa** → `findFirst` para decidir el `404` y luego la escritura. Es una consulta más por operación de escritura. A este volumen es irrelevante, y compra el comportamiento indistinguible de la decisión 3.

- **Los tests existentes van a romperse en bloque** → Las suites de los cuatro módulos llaman a los services sin contexto de propiedad. Todas necesitan actualizarse. Es trabajo mecánico pero extenso, y es el grueso del esfuerzo de este change.

- **Sigue sin haber forma de compartir finanzas** → El nombre `partner-chores-api` sugiere que la intención original era una aplicación para dos personas. Este change consolida el modelo contrario: aislamiento estricto. Si en algún momento se quiere compartir, no bastará con relajar el filtro — hará falta el modelo de espacio compartido con membresías que se descartó al elegir esta opción. Cambiar de idea más adelante es caro, y este es el momento de estar seguro.

## Migration Plan

1. **Inspeccionar los datos existentes** en `accounts`, `incomes` y `expenses`, y confirmar que todos pertenecen conceptualmente a la misma persona.
2. **Copia de seguridad de la base de datos.** Primera migración que reescribe filas.
3. Confirmar que existe un usuario administrador único (`add-roles-permissions` debe estar aplicado y con su bootstrap hecho).
4. Añadir `user_id` a los tres modelos en `prisma/schema.prisma`, `npx prisma migrate dev --create-only`.
5. Editar el SQL siguiendo la secuencia de la decisión 9: columna nullable → backfill → `NOT NULL` → FK.
6. Aplicar y **verificar que ninguna de las tres tablas tiene `user_id` nulo**.
7. Emitir el catálogo de permisos con las variantes `OWN` y `ANY`, y asignar las `OWN` al rol `user`.
8. Desplegar el código con el filtrado activo.
9. Verificar con dos usuarios reales que ninguno ve nada del otro.

**Rollback:** revertir el código restaura el acceso global. Revertir la migración exige quitar la FK y la columna; los datos no se pierden, pero la adjudicación de propietarios sí, y rehacerla depende de la copia de seguridad.

**Dependencias:** `add-roles-permissions` implementado y con bootstrap hecho. `add-expenses-crud` implementado.

## Open Questions

- ¿Debe un administrador poder ver los movimientos de otros usuarios, o su `ANY` limitarse a los recursos administrativos y dejar las finanzas personales fuera del alcance de todo el mundo salvo su dueño? Es una decisión de producto y conviene tomarla antes de que haya usuarios externos.
- Si en el futuro se quiere compartir finanzas entre dos personas, ¿se construye sobre este modelo (relajando el filtro con una tabla de compartición) o se migra al modelo de espacio compartido? La primera opción es más barata y acaba peor.
- ¿Conviene registrar en un log los accesos con scope `ANY` a datos ajenos? Es lo mínimo si el privilegio se conserva.
- `Account.balance` sigue sin reflejar la suma de movimientos. Ahora que las cuentas tienen dueño, un saldo calculado por usuario es más fácil de definir — quizá sea el momento de cerrar esa deuda.
