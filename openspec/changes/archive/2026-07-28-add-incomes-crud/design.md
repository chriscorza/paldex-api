## Context

`paldex-api` es un NestJS 11 con Prisma 7 sobre MySQL 8.4 (a través del adapter `@prisma/adapter-mariadb`, ver `src/prisma.service.ts`). El módulo `incomes` está a medias: sólo `GET /incomes`, público, con un `Prisma.IncomeWhereInput` vacío hardcodeado y el resto de handlers comentados. Los DTOs son clases vacías y los dos `.spec.ts` sólo comprueban `toBeDefined()`.

Restricciones del entorno que condicionan el diseño:

- **El `AuthGuard` es global** (`APP_GUARD` en `app.module.ts`). Proteger `/incomes` no requiere añadir nada: basta con borrar el `@Public()`.
- **No hay `ValidationPipe` global.** `main.ts` sólo configura CORS. Sin él, los decoradores de `class-validator` en los DTOs no se ejecutan y los query params llegan siempre como `string`.
- **`Income` no tiene `user_id`.** No hay forma de scopear ingresos por usuario sin migración; se decidió no hacerla en este cambio.
- **Los servicios hablan con Prisma directamente**, sin capa de repositorio. Se mantiene ese patrón.
- **MySQL, no Postgres.** Esto restringe algunas opciones de Prisma que sí existirían en Postgres.

## Goals / Non-Goals

**Goals:**

- Cinco endpoints CRUD funcionando en `/incomes`, todos autenticados.
- `FilteredInput` aplicado de verdad, con respuesta paginada `{ data, total, page, limit }`.
- Gestión de la relación `taxes` desde create y update.
- Validación de entrada real y errores HTTP correctos (`400` / `404`) en vez de excepciones de Prisma filtrándose como `500`.
- Tests unitarios que cubran la traducción de filtros y los casos de error, no sólo `toBeDefined()`.

**Non-Goals:**

- Añadir `user_id` a `Income` o cualquier otra migración de esquema.
- Módulos `Account`, `Tax` o `Expense`.
- Tocar el frontend `paldex-app` o el flujo de auth (hashing de contraseñas, Google OAuth).
- Soft deletes, auditoría o versionado de la API.

## Decisions

### 1. La traducción de `FilteredInput` vive en el service, no en el controller

El controller recibe el DTO de filtros y lo pasa entero al service; es el service quien construye el `Prisma.IncomeWhereInput` y el `orderBy`.

*Por qué:* el controller actual ya intenta construir el `where` y por eso quedó como stub — es el sitio equivocado. Poner la traducción en el service la hace testeable sin levantar el stack HTTP y deja el controller como una capa fina de routing, coherente con el resto de módulos.

*Alternativa descartada:* un `PipeTransform` que convierta `FilteredInput` en `IncomeWhereInput`. Más elegante en teoría, pero acopla un pipe a un tipo de Prisma y complica el testing sin ganancia real con un solo módulo consumidor.

### 2. DTO de filtros propio (`FilterIncomesDto`), no `FilteredInput` directamente

`src/types.ts` define `FilteredInput` como un `type`, no una clase. Un `type` de TypeScript desaparece en runtime, así que el `ValidationPipe` no puede validar ni transformar contra él: `page` y `limit` seguirían llegando como `string` y `?page=0` pasaría sin más.

Se crea `src/incomes/dto/filter-incomes.dto.ts` como **clase** con decoradores (`@IsOptional`, `@IsDateString`, `@IsInt`, `@Min`, `@IsIn`), y se deja `FilteredInput` en `src/types.ts` intacto como contrato compartido — el DTO lo implementa (`implements FilteredInput`) para que ambos no diverjan.

*Por qué no convertir `FilteredInput` en clase directamente:* es un tipo compartido pensado para ser reutilizado por futuros módulos (`expenses`, etc.) con campos ordenables distintos. La lista de `sort_by` válidos es específica de cada recurso.

### 3. `sort_by` restringido a una allowlist

Sólo se aceptan `date`, `amount`, `concept`, `created_at`, `id`. Cualquier otro valor devuelve `400`.

*Por qué:* pasar un `sort_by` arbitrario a `orderBy` deja que el cliente ordene por columnas que no debería tocar y provoca un error de Prisma (→ `500`) ante cualquier typo. Una allowlist con `@IsIn` da un `400` claro. Por defecto, `date desc`.

### 4. Búsqueda con `contains` a secas, sin `mode: 'insensitive'`

`Prisma.QueryMode` / `mode: 'insensitive'` **no está disponible en el conector MySQL** — es exclusivo de PostgreSQL y MongoDB. Usarlo no compilaría.

La insensibilidad a mayúsculas del escenario "Búsqueda por concepto" la aporta la collation de la propia columna: MySQL 8 usa por defecto `utf8mb4_0900_ai_ci`, que ya es case-insensitive. Se usa `{ concept: { contains: search } }` y basta.

*Riesgo asumido:* si alguien cambia la collation de la tabla a `_bin` o `_cs`, la búsqueda pasa a ser case-sensitive en silencio. Se documenta en el test correspondiente.

### 5. `findAll` usa `$transaction([findMany, count])`

Para devolver `total` hacen falta dos consultas. Se lanzan dentro de `this.prisma.$transaction([...])` con el **mismo objeto `where`**.

*Por qué:* garantiza que `data` y `total` correspondan al mismo snapshot; si se ejecutan sueltas, una escritura concurrente puede producir un `total` incoherente con la página devuelta. Es además un único round-trip.

### 6. Sincronización de taxes: `deleteMany` + `createMany` dentro de la transacción de escritura

En `create`, se usa el nested write de Prisma (`taxes: { create: tax_ids.map(...) }`) para que income y filas puente nazcan atómicamente.

En `update`, cuando `tax_ids` viene presente, se hace `taxes: { deleteMany: {}, create: [...] }` en el mismo `update`. Cuando `tax_ids` está **ausente** (`undefined`), no se toca la relación en absoluto.

*Nota importante:* distinguir `undefined` (no tocar) de `[]` (vaciar) exige comprobar `'tax_ids' in dto` o `dto.tax_ids !== undefined`, **no** un truthy check — `[]` es truthy en JS pero `tax_ids: []` debe vaciar la relación, y ese es un escenario explícito de la spec.

*Alternativa descartada:* diffear el conjunto actual contra el nuevo y aplicar sólo las diferencias. `IncomeTax` no tiene columnas propias más allá de la PK compuesta, así que borrar y recrear es equivalente y mucho más simple.

### 7. Validación de FKs explícita, no por captura de error de Prisma

Antes de escribir, el service comprueba que `account_id` existe y que todos los `tax_ids` existen (`count` sobre `id: { in: tax_ids }` comparado con `tax_ids.length`), y lanza `BadRequestException` si no.

*Por qué:* Prisma devuelve `P2003` (foreign key constraint failed) sin decir qué FK falló, lo que da un mensaje inútil al cliente. La comprobación previa permite un `400` con un mensaje concreto.

*Trade-off aceptado:* hay una ventana TOCTOU — la cuenta podría borrarse entre la comprobación y el insert. En ese caso Prisma fallaría de todos modos, así que el peor caso es un `500` en una carrera muy improbable, no corrupción de datos. Se mantiene un `catch` de `P2003` como red de seguridad que también devuelve `400`.

### 8. `404` mediante comprobación previa en `findOne`, `update` y `remove`

Cada uno hace un `findUnique` primero y lanza `NotFoundException` si no hay resultado. Para `update` y `remove` esto evita depender del `P2025` de Prisma.

*Por qué no un interceptor o filtro de excepciones global de Prisma:* sería la solución escalable con 5-6 módulos, pero aquí sólo hay uno y añadiría infraestructura que nadie más usa todavía. Cuando existan `expenses` y `accounts`, extraer un `PrismaExceptionFilter` será el refactor natural.

### 9. `ValidationPipe` global con `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`

Va en `main.ts`, aplicado a toda la app.

*Por qué global y no por handler:* `transform: true` es lo que convierte `page`/`limit` de `string` a `number`; hacerlo handler a handler se olvida sistemáticamente.

*Efecto colateral a vigilar:* `POST /auth/login` recibe `@Body() loginData: { email, password }` — un type literal, sin clase. `ValidationPipe` **ignora** los parámetros cuyo metatipo no es una clase con validadores, así que este endpoint sigue funcionando sin cambios. `POST /auth/user` recibe `Prisma.UserCreateInput`, también un type, mismo caso. Ninguno de los dos se rompe, pero tampoco gana validación — queda como deuda conocida, fuera del alcance de este cambio. Hay una tarea explícita para verificarlo con una petición real.

### 10. Forma de la respuesta paginada

```ts
{ data: Income[], total: number, page: number, limit: number }
```

Se devuelven `page` y `limit` efectivos (ya con los defaults aplicados), no los crudos del query, para que el cliente sepa qué se usó realmente. No se devuelve `totalPages` — es derivable con `Math.ceil(total / limit)` y añadir campos redundantes invita a que se desincronicen.

## Risks / Trade-offs

- **[BREAKING] `GET /incomes` cambia de `Income[]` a un objeto envolvente** → El único consumidor (`paldex-app/src/API/IncomesResource.tsx`) devuelve mocks hardcodeados y nunca llega al fetch real, así que hoy no rompe nada. Cuando se conecte de verdad, habrá que leer `.data`. Queda anotado en las tareas para no perderlo de vista.

- **[BREAKING] `/incomes` deja de ser público** → El frontend hace login con Google OAuth decodificando el credential en cliente y **no llama a `POST /auth/login`**, por lo que no tiene un JWT de este backend en `localStorage`. En cuanto se proteja el endpoint, la pantalla de ingresos devolverá `401` en el momento en que se conecte a la API real. `BaseResource` ya redirige a `/cerrar-sesion` ante un `401`, así que el fallo será visible, no silencioso. Mitigación: es un cambio consciente; conectar el login real al backend es el siguiente paso natural y debería ir en su propio change.

- **Los incomes siguen siendo globales** → Exigir JWT da la impresión de que los datos están aislados por usuario, y no lo están: cualquier usuario autenticado ve y edita los ingresos de todos. Es una mejora sobre el estado actual (público para cualquiera), pero **no** es multi-tenancy. Mitigación: dejarlo escrito aquí y en el proposal, y abrir un change para `Income.user_id` antes de que haya datos de más de un usuario en producción.

- **`limit` sin techo permite `?limit=999999`** → Un cliente autenticado puede pedir la tabla entera y tumbar la memoria del proceso. Mitigación: `@Max(100)` en el DTO, con `400` por encima de ese valor.

- **`amount` es `Float` en el esquema** → Los floats binarios no son adecuados para dinero (errores de redondeo acumulativos). Está fuera del alcance de este cambio, pero conviene migrar a `Decimal` antes de que haya datos reales. Sólo se señala; no se toca.

- **El `ValidationPipe` global toca todos los endpoints existentes** → `forbidNonWhitelisted: true` puede rechazar peticiones que antes pasaban. Analizado en la decisión 9: los DTOs de auth son types, no clases, así que el pipe los ignora. Aun así hay una tarea de verificación manual con `/auth/login` y `/auth/user` antes de dar el cambio por bueno.

## Migration Plan

Sin migraciones de base de datos — el esquema Prisma ya soporta todo.

Orden de despliegue sugerido:

1. Mergear el backend. `GET /incomes` empieza a exigir JWT y a devolver la forma nueva.
2. El frontend sigue funcionando exactamente igual mientras `IncomesApi.getAll()` devuelva mocks.
3. Antes de conectar el frontend a la API real: cablear `POST /auth/login` para obtener un JWT de verdad, y adaptar el consumidor a `response.data`.

Rollback: revertir el commit. No hay estado persistente nuevo que deshacer.

## Open Questions

- ¿Debería `DELETE /incomes/:id` devolver `200` con el objeto borrado o `204 No Content`? La spec asume `200` con el objeto, por consistencia con lo que devuelve Prisma y porque le da al cliente algo con lo que hacer un undo optimista. Fácil de cambiar si se prefiere `204`.
- ¿Hace falta un endpoint de agregados (suma de ingresos por rango) para la UI? No entra aquí, pero es previsible que la pantalla de dashboard lo pida pronto.
