## Why

El módulo `incomes` sólo expone `GET /incomes`, es público, y descarta los filtros que recibe: el controller construye un `Prisma.IncomeWhereInput` vacío y devuelve la tabla entera. Los handlers de create/update/delete están comentados y los DTOs (`CreateIncomeDto`, `UpdateIncomeDto`) son clases vacías, así que el frontend no tiene forma de registrar ni editar ingresos — `IncomesApi.getAll()` sigue devolviendo mocks porque no hay una API real contra la que trabajar.

## What Changes

- **Completar el CRUD de `/incomes`**: añadir `POST /incomes`, `GET /incomes/:id`, `PATCH /incomes/:id` y `DELETE /incomes/:id`, sustituyendo los handlers comentados.
- **Aplicar de verdad `FilteredInput`** en `GET /incomes`: rango de fechas (`start_date`/`end_date` sobre `date`), búsqueda por `concept` (`search`), ordenación (`sort_by`/`order`) y paginación (`page`/`limit`).
- **BREAKING** — `GET /incomes` pasa de devolver `Income[]` a devolver `{ data, total, page, limit }`, para que la UI pueda paginar. El consumidor actual (`paldex-app/src/API/IncomesResource.tsx`) devuelve mocks y no lee la respuesta real, así que el impacto práctico es nulo hoy, pero el contrato cambia.
- **BREAKING** — se retira `@Public()` del `IncomesController`: los cinco endpoints pasan a exigir `Authorization: Bearer <jwt>` a través del `AuthGuard` global.
- **Gestión de la relación `taxes`**: create y update aceptan `tax_ids: number[]` y sincronizan la tabla puente `income_taxes`; las lecturas incluyen los taxes asociados.
- **Validación de entrada**: DTOs con decoradores de `class-validator` (ya está en `dependencies`) y un `ValidationPipe` global con `whitelist` y `transform` en `main.ts`.
- **Errores tipados**: `404 Not Found` cuando el `id` no existe, `400 Bad Request` cuando `account_id` o algún `tax_id` no corresponde a un registro real.

### No incluido (non-goals)

- No se añade `user_id` al modelo `Income`. Los ingresos siguen siendo globales, no por usuario; cualquier usuario autenticado ve los mismos datos. Se decidió explícitamente dejar esa migración para un cambio posterior.
- No se tocan `Expense`, `Account` ni `Tax` — no se crean sus módulos.
- No se cambia el hashing de contraseñas ni ninguna otra parte del flujo de auth.
- No se toca el frontend `paldex-app`.

## Capabilities

### New Capabilities
- `incomes-crud`: alta, consulta, listado filtrado y paginado, edición y borrado de ingresos, incluida la asociación con taxes y las reglas de validación y autorización de esos endpoints.

### Modified Capabilities

Ninguna. `openspec/specs/` está vacío — es la primera capability del proyecto.

## Impact

**Código afectado (`paldex-api`)**
- `src/incomes/incomes.controller.ts` — cinco handlers, traducción de `FilteredInput`, retirada de `@Public()`.
- `src/incomes/incomes.service.ts` — métodos `create`, `findAll`, `findOne`, `update`, `remove`; conteo para `total`; sincronización de `income_taxes` en transacción.
- `src/incomes/dto/create-income.dto.ts`, `src/incomes/dto/update-income.dto.ts` — campos reales y validadores.
- `src/incomes/dto/filter-incomes.dto.ts` — nuevo; versión validada/transformada de `FilteredInput` (los query params llegan como string).
- `src/incomes/entities/income.entity.ts` — forma de la respuesta.
- `src/main.ts` — `ValidationPipe` global.
- `src/incomes/incomes.controller.spec.ts`, `src/incomes/incomes.service.spec.ts` — hoy sólo verifican `toBeDefined()`.

**Contrato de API**: dos cambios rompedores en `GET /incomes` (forma de la respuesta y autenticación obligatoria). El `ValidationPipe` global con `whitelist: true` también afecta a `POST /auth/login` y `POST /auth/user`, cuyos bodies hoy no están validados — hay que confirmar que siguen aceptando su payload actual.

**Dependencias**: ninguna nueva. `class-validator` y `class-transformer` ya están instalados.

**Base de datos**: sin migraciones. El esquema Prisma existente (`Income`, `IncomeTax`) cubre todo lo necesario.
