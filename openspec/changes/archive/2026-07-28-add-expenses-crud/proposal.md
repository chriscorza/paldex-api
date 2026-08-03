## Why

`Expense` es el reflejo exacto de `Income` en el esquema — mismos campos, misma FK a `Account`, misma tabla puente a `Tax` — y es la mitad que falta de la funcionalidad central de una app de finanzas personales. Sin ella, `paldex` sólo sabe registrar lo que entra. El modelo lleva definido desde el commit inicial sin módulo Nest ni ninguna ruta.

## What Changes

- **Nuevo módulo `expenses`** (`src/expenses/`) reflejando `src/incomes/`: module, controller, service, `dto/`, `entities/`.
- **CRUD completo**: `POST /expenses`, `GET /expenses`, `GET /expenses/:id`, `PATCH /expenses/:id`, `DELETE /expenses/:id`.
- **Todos los endpoints autenticados** vía el `AuthGuard` global, sin `@Public()`.
- **Listado filtrado y paginado** idéntico al de incomes: `{ data, total, page, limit }`, con rango de fechas, `search` sobre `concept`, `sort_by`/`order` y `page`/`limit`.
- **Filtro adicional por `account_id`**, para poder ver los gastos de una cuenta concreta. Se añade también al módulo de incomes por simetría — es el único punto donde este change toca código existente.
- **Gestión de la relación `taxes`** vía `tax_ids: number[]`, sincronizando `expense_taxes` con la misma semántica que incomes (`undefined` no toca, `[]` vacía).
- **Errores tipados**: `404` si el id no existe, `400` si `account_id` o algún `tax_id` no corresponde a un registro real.
- **Extracción de los helpers de filtrado compartidos** a `src/common/`, para que incomes y expenses no dupliquen la traducción de `FilteredInput` a `WhereInput`.

### No incluido (non-goals)

- No se abstrae el CRUD entero en una clase base genérica. Sólo se comparte la traducción de filtros — ver la decisión 1 del `design.md`.
- No se recalcula `Account.balance` al crear o borrar un expense. La deuda descrita en `add-accounts-crud` sigue igual de abierta, y con expenses en juego se vuelve más visible.
- No se añade `user_id` a `Expense`.
- No se migra `amount` de `Float` a `Decimal`.
- No se implementa categorización de gastos, presupuestos ni gastos recurrentes.

## Capabilities

### New Capabilities
- `expenses-crud`: alta, consulta, listado filtrado y paginado, edición y borrado de gastos, incluida la asociación con taxes y las reglas de validación y autorización de esos endpoints.

### Modified Capabilities
- `incomes-crud`: se añade el filtro `account_id` a `GET /incomes`, que la spec original no contempla. Es una adición al listado, no un cambio de comportamiento existente.

## Impact

**Código nuevo (`paldex-api`)**
- `src/expenses/expenses.module.ts`, `.controller.ts`, `.service.ts`
- `src/expenses/dto/create-expense.dto.ts`, `update-expense.dto.ts`, `filter-expenses.dto.ts`
- `src/expenses/entities/expense.entity.ts`
- `src/expenses/expenses.controller.spec.ts`, `expenses.service.spec.ts`
- `src/common/filters/` — helpers compartidos de traducción de filtros y paginación

**Código modificado**
- `src/app.module.ts` — registrar `ExpensesModule`.
- `src/incomes/incomes.service.ts` y `dto/filter-incomes.dto.ts` — pasar a usar los helpers compartidos y aceptar `account_id`. **Este change depende de que `add-incomes-crud` esté implementado**; refactorizar contra un módulo a medias no tiene sentido.

**Dependencias**: ninguna nueva.

**Base de datos**: sin migraciones. `Expense` y `ExpenseTax` ya existen.

**Orden respecto a otros changes**: es el último de los cuatro. Necesita `add-incomes-crud` implementado (para reflejarlo y extraer lo común) y, en la práctica, `add-accounts-crud` y `add-taxes-crud` para poder probarse de punta a punta.
