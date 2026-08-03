## Why

El modelo `Account` existe en `prisma/schema.prisma` desde el commit inicial pero no tiene módulo Nest ni una sola ruta. Es un bloqueo duro: tanto `Income` como `Expense` tienen `account_id` como FK obligatoria, y el change `add-incomes-crud` valida esa FK contra la base de datos antes de escribir. Sin endpoints de accounts no hay forma de crear una cuenta por API, así que **no se puede crear ni un solo income sin insertar filas a mano en phpMyAdmin**.

## What Changes

- **Nuevo módulo `accounts`** (`src/accounts/`) siguiendo el patrón de `incomes/`: module, controller, service, `dto/`, `entities/`.
- **CRUD completo**: `POST /accounts`, `GET /accounts`, `GET /accounts/:id`, `PATCH /accounts/:id`, `DELETE /accounts/:id`.
- **Todos los endpoints autenticados** vía el `AuthGuard` global — sin `@Public()`, igual que el criterio adoptado en `add-incomes-crud`.
- **Listado filtrado y paginado** con la misma forma de respuesta que incomes: `{ data, total, page, limit }`, con filtros por `search` (sobre `name`), `type`, `sort_by`/`order` y `page`/`limit`.
- **Validación del enum `AccountType`** (`CASH`, `CREDIT_CARD`, `DEBIT_CARD`, `OTHER`) y regla de negocio: `credit_limit` es obligatorio cuando `type` es `CREDIT_CARD` y debe rechazarse para los demás tipos.
- **Borrado protegido**: si la cuenta tiene incomes o expenses asociados, el sistema responde `409 Conflict` en lugar de dejar que Prisma lance un error de FK sin contexto.
- **`GET /accounts/:id` incluye contadores** de incomes y expenses asociados, para que la UI pueda avisar antes de intentar borrar.

### No incluido (non-goals)

- **No se recalcula `balance` a partir de las transacciones.** `balance` sigue siendo un valor almacenado que el cliente escribe; no se actualiza automáticamente al crear un income o un expense. Ver los riesgos en `design.md` — es la deuda más importante que deja este change.
- No se migra `balance` ni `credit_limit` de `Float` a `Decimal`.
- No se añade `user_id` a `Account`: igual que los incomes, las cuentas son globales y cualquier usuario autenticado las ve todas.
- No se tocan `Tax`, `Expense`, `Income` ni el flujo de auth.

## Capabilities

### New Capabilities
- `accounts-crud`: alta, consulta, listado filtrado y paginado, edición y borrado de cuentas, incluidas las reglas del enum `AccountType`, la restricción de `credit_limit` y la protección de borrado frente a transacciones asociadas.

### Modified Capabilities

Ninguna. `add-incomes-crud` introduce `incomes-crud` pero este change no altera sus requisitos: la validación de `account_id` que hace incomes ya está especificada allí y no cambia.

## Impact

**Código nuevo (`paldex-api`)**
- `src/accounts/accounts.module.ts`, `.controller.ts`, `.service.ts`
- `src/accounts/dto/create-account.dto.ts`, `update-account.dto.ts`, `filter-accounts.dto.ts`
- `src/accounts/entities/account.entity.ts`
- `src/accounts/accounts.controller.spec.ts`, `accounts.service.spec.ts`

**Código modificado**
- `src/app.module.ts` — registrar `AccountsModule` en `imports`.

**Dependencias**: ninguna nueva. `class-validator` y `class-transformer` ya están instalados.

**Base de datos**: sin migraciones. El modelo `Account` y el enum `AccountType` ya existen.

**Relación con otros changes**: comparte convenciones con `add-incomes-crud` (respuesta paginada, `ValidationPipe` global, allowlist de `sort_by`). Si ese change aún no está implementado, este debe registrar el `ValidationPipe` global él mismo — la tarea está marcada como condicional.
