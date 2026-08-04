## Context

El frontend identificó 6 hallazgos durante el análisis de integración. Estos bugs y omisiones requieren correcciones en el backend para desbloquear funcionalidad del frontend y corregir problemas de seguridad (falta de DTOs/whitelist, filtros de owner ausentes).

### Estado actual por área

**Export CSV**: `GET /reports/monthly/export?format=csv` delega en `exportMonthlyCsv()` (controller:208-213), que obtiene los mismos `aggregates` y retorna `report` (JSON). No hay serialización CSV. `format=pdf` lanza `BadRequestException`.

**Payables/Receivables**: Únicos 2 módulos sin DTOs. `create` tiene whitelist manual en el service, pero `update` pasa el body crudo a `prisma.*.update({ data: dto })` — un cliente puede sobreescribir `user_id`, `paid_amount`, `collected_amount`. Receivables no tiene `DELETE /receivables/collections/:id` (payables sí tiene `DELETE /payables/payments/:id`).

**Tax payments cancel**: `PATCH /tax-payments/:id` no acepta `status`. Al intentar `DELETE /tax-payments/:id` con status `PAID`, devuelve 409: "Cannot delete a paid tax payment. Cancel it instead." — pero no hay endpoint para cancelar.

**Owner filtering**: `getMissing` recibe `ctx` pero no lo usa. `recalculateCosts` ni siquiera recibe `@CurrentUser()`. `getCashReport` tiene 4 queries sin `ownerFilter`.

**Shopify i18n**: `shopify-profitability.service.ts` hardcodea `'Sin categoría'` (línea 103) y `'Sin canal'` (líneas 331, 354).

## Goals / Non-Goals

**Goals:**
- Implementar serialización CSV real para `GET /reports/monthly/export?format=csv`
- Agregar DTOs con `class-validator` a payables y receivables, con whitelist en updates
- Agregar `DELETE /receivables/collections/:id`
- Permitir cancelar tax payments vía `PATCH /tax-payments/:id` con `status: "CANCELLED"`
- Agregar filtros de owner a `getMissing`, `recalculateCosts`, y `getCashReport`
- Reemplazar strings hardcodeados en reportes Shopify por keys neutrales

**Non-Goals:**
- Implementar export PDF (sigue sin implementarse, mismo error 400)
- Agregar DTOs de query/filtro a payables/receivables (solo create/update en este change)
- Modificar `cash_available` de MonthlyClose (es placeholder intencional según design doc)
- Internacionalización completa — solo se cambian las keys, el frontend mapea

## Decisions

### 1. CSV: construir string en memoria, sin librería externa

**Decisión**: Construir el CSV con `Array.join` e incluir una función `escapeCsvField()`.

**Alternativas**: `csv-stringify` (npm), `papaparse`.
**Razón**: El reporte tiene columnas fijas y pocas filas (es un solo reporte agregado, no un dump). No justifica una dependencia. El patrón `escapeCsvField` es ~5 líneas y cubre quotes y comas.

**Formato de respuesta**: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="reporte-mensual-YYYY-MM.csv"`. Solo cuando `format=csv`. Sin `format`, el comportamiento sigue igual (JSON).

### 2. DTOs de payables/receivables: seguir el patrón existente

**Decisión**: Crear `CreatePayableDto`, `UpdatePayableDto`, `CreateReceivableDto`, `UpdateReceivableDto`, `AddPayablePaymentDto`, `AddReceivableCollectionDto` en `src/payables/dto/` y `src/receivables/dto/`. Usar `class-validator` + `@ApiProperty` + `whitelist: true` en el `ValidationPipe` global (ya configurado).

**Whitelist en update del service**: Replicar el patrón de `tax-payments.service.ts:update()` — construir un objeto `updateData` solo con los campos definidos en el DTO.
```
// Ejemplo para payable:
const updateData: any = {};
if (dto.vendor !== undefined) updateData.vendor = dto.vendor;
if (dto.concept !== undefined) updateData.concept = dto.concept;
...
```

### 3. Receivables: nuevo endpoint DELETE /receivables/collections/:id

**Decisión**: Agregar `removeCollection` al controller y service de receivables, simétrico a `removePayment` de payables. Permiso: `receivable:update` (mismo que payables usa `payable:update` para delete de pago).

### 4. Tax payments: status en PATCH, no endpoint separado

**Decisión**: Agregar `status` al `UpdateTaxPaymentDto` con validación `@IsEnum(['CANCELLED'])`. Solo se acepta el valor `CANCELLED` (no `PENDING` ni `PAID` — esos se gestionan por create/pay). Validación en el service: solo se permite cancelar si `existing.status === 'PAID'`.

**Alternativa**: Crear `POST /tax-payments/:id/cancel`.
**Razón para elegir PATCH**: El PATCH ya existe y acepta una whitelist de campos. Agregar `status` es más simple que un endpoint nuevo. Además, "cancelar" es conceptualmente una transición de estado — el PATCH semánticamente encaja. Se valida en el service que la transición `PAID → CANCELLED` sea la única permitida.

### 5. Owner filtering: usar los patrones existentes del codebase

**Decisión**: 
- `getMissing`: filtrar `ShopifyLineItem` via `shopify_order → shopify_connection → user_id` (patrón de `getCategoryProfitability`, línea 24-31).
- `recalculateCosts`: el controlador debe recibir `@CurrentUser()` y `@Req()`, construir ctx, y pasarlo. El service aplica owner filter en el `findMany` de `shopifyOrder`.
- `getCashReport`: 
  - Payroll payments: `employee: { ...ownerFilter }` (patrón de `getMonthlyAggregates` líneas 75, 85)
  - Tax payments: `{ ...ownerFilter }` (TaxPayment tiene `user_id`, patrón de `getMonthlyAggregates` líneas 91, 97)

### 6. Shopify i18n: keys en inglés, sin enum ni tipo nuevo

**Decisión**: Cambiar `'Sin categoría'` → `'uncategorized'` y `'Sin canal'` → `'no_channel'`. Son strings planos, no se crea un enum ni tipo. El frontend recibe estas keys y las traduce.

**Breaking change**: El frontend debe actualizar su mapping. Si antes mostraba `"Sin categoría"` directo, ahora debe buscar `"uncategorized"` en sus traducciones.

## Risks / Trade-offs

- **[Breaking] CSV response type**: Cambiar `Content-Type` de `application/json` a `text/csv` cuando `format=csv`. Si el frontend llamaba este endpoint sin `format` y parseaba JSON, no se rompe. Si llamaba con `format=csv` esperando JSON, se rompe — pero ese era el bug reportado.
- **[Breaking] Shopify report keys**: El frontend debe actualizar su mapping de `"Sin categoría"` → `"uncategorized"` y `"Sin canal"` → `"no_channel"`. Comunicar al equipo de frontend.
- **[Security] DTOs**: Agregar DTOs con `whitelist: true` es un hardening positivo. No rompe clientes que envíen los campos esperados. Clientes que envíen campos extra recibirán 400 — esto es intencional y alinea payables/receivables con el resto del API.
- **[Scope] getCashReport performance**: Agregar `employee: { ...ownerFilter }` requiere un join extra en las queries de payroll. El impacto es mínimo porque ya hay joins similares en `getMonthlyAggregates`.
