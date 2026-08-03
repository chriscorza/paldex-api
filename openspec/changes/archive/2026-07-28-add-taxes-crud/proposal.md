## Why

El modelo `Tax` existe en `prisma/schema.prisma` desde el commit inicial pero no tiene módulo Nest ni ninguna ruta. Es el otro prerequisito bloqueante junto con `accounts`: el change `add-incomes-crud` acepta `tax_ids` y valida cada uno contra la tabla `taxes` antes de escribir, así que sin endpoints de taxes no hay forma de crear un impuesto por API y la funcionalidad de asociar impuestos a un ingreso queda inalcanzable.

## What Changes

- **Nuevo módulo `taxes`** (`src/taxes/`) siguiendo el patrón de `incomes/`: module, controller, service, `dto/`, `entities/`.
- **CRUD completo**: `POST /taxes`, `GET /taxes`, `GET /taxes/:id`, `PATCH /taxes/:id`, `DELETE /taxes/:id`.
- **Todos los endpoints autenticados** vía el `AuthGuard` global, sin `@Public()`.
- **Listado filtrado y paginado** con la misma forma de respuesta que el resto del proyecto: `{ data, total, page, limit }`, con `search` sobre `name`, `sort_by`/`order` y `page`/`limit`.
- **`rate` interpretado como porcentaje** (`21` significa 21 %), validado entre 0 y 100. Ver la nota de ambigüedad en `design.md`.
- **Nombre único**: se rechaza con `409 Conflict` la creación de un impuesto cuyo `name` ya existe, para evitar duplicados tipo "IVA" / "IVA " que luego nadie distingue en un desplegable.
- **Borrado protegido**: si el impuesto está asociado a algún income o expense, el sistema responde `409 Conflict` en lugar de dejar que el `onDelete: Cascade` del esquema borre silenciosamente las filas de `income_taxes`/`expense_taxes` y altere registros históricos.
- **`GET /taxes/:id` incluye contadores** de incomes y expenses que usan el impuesto.

### No incluido (non-goals)

- **No se añade una restricción `@unique` a `Tax.name` en el esquema.** La unicidad se comprueba en el service; formalizarla en base de datos requiere migración y limpiar posibles duplicados existentes. Ver riesgos en `design.md`.
- No se versiona el `rate`: cambiar el porcentaje de un impuesto afecta a cualquier cálculo futuro sobre registros históricos que lo usen. Es una limitación conocida, no se resuelve aquí.
- No se calcula el importe de impuesto de ningún income o expense — este módulo sólo gestiona el catálogo.
- No se migra `rate` de `Float` a `Decimal`.
- No se añade `user_id` a `Tax`: el catálogo es global.

## Capabilities

### New Capabilities
- `taxes-crud`: alta, consulta, listado filtrado y paginado, edición y borrado del catálogo de impuestos, incluida la validación del rango de `rate`, la unicidad del nombre y la protección de borrado frente a impuestos en uso.

### Modified Capabilities

Ninguna.

## Impact

**Código nuevo (`paldex-api`)**
- `src/taxes/taxes.module.ts`, `.controller.ts`, `.service.ts`
- `src/taxes/dto/create-tax.dto.ts`, `update-tax.dto.ts`, `filter-taxes.dto.ts`
- `src/taxes/entities/tax.entity.ts`
- `src/taxes/taxes.controller.spec.ts`, `taxes.service.spec.ts`

**Código modificado**
- `src/app.module.ts` — registrar `TaxesModule` en `imports`.

**Dependencias**: ninguna nueva.

**Base de datos**: sin migraciones. Los modelos `Tax`, `IncomeTax` y `ExpenseTax` ya existen.

**Relación con otros changes**: junto con `add-accounts-crud`, desbloquea el uso real de `add-incomes-crud`. Comparte todas sus convenciones (respuesta paginada, `ValidationPipe` global, allowlist de `sort_by`).
