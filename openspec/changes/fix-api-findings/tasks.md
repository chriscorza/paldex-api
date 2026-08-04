## 1. Payables/Receivables DTOs

- [x] 1.1 Crear `src/payables/dto/create-payable.dto.ts` con `CreatePayableDto` (vendor, concept, total_amount, due_date, account_id?, notes?)
- [x] 1.2 Crear `src/payables/dto/update-payable.dto.ts` con `UpdatePayableDto` (todos opcionales, mismos campos)
- [x] 1.3 Crear `src/payables/dto/add-payable-payment.dto.ts` con `AddPayablePaymentDto` (amount, payment_date, account_id?, notes?)
- [x] 1.4 Crear `src/receivables/dto/create-receivable.dto.ts` con `CreateReceivableDto` (customer, concept, total_amount, due_date, related_income_id?, notes?)
- [x] 1.5 Crear `src/receivables/dto/update-receivable.dto.ts` con `UpdateReceivableDto` (todos opcionales, mismos campos)
- [x] 1.6 Crear `src/receivables/dto/add-receivable-collection.dto.ts` con `AddReceivableCollectionDto` (amount, payment_date, account_id?, notes?)
- [x] 1.7 Tipar `@Body()` en `payables.controller.ts` con los nuevos DTOs
- [x] 1.8 Tipar `@Body()` en `receivables.controller.ts` con los nuevos DTOs
- [x] 1.9 Agregar whitelist de campos en `payables.service.ts` update (construir updateData, no pasar dto crudo a Prisma)
- [x] 1.10 Agregar whitelist de campos en `receivables.service.ts` update (construir updateData, no pasar dto crudo a Prisma)

## 2. Receivables: delete collection endpoint

- [x] 2.1 Agregar `removeCollection` a `receivables.service.ts` (buscar collection con owner check via receivable, eliminar)
- [x] 2.2 Agregar `DELETE /receivables/collections/:id` a `receivables.controller.ts`
- [x] 2.3 Agregar permiso `receivable:update` al nuevo endpoint (sin entrada nueva en catálogo; mismo permiso que payables usa para delete payment)

## 3. Reports CSV export

- [x] 3.1 Crear `escapeCsvField()` helper en `reports.controller.ts` o en `src/common/csv.ts`
- [x] 3.2 Implementar serialización CSV del `ProfitReport` en `exportMonthlyCsv()` — headers + fila de valores
- [x] 3.3 Configurar `Content-Type: text/csv` y `Content-Disposition: attachment; filename="reporte-mensual-YYYY-MM.csv"` en la respuesta
- [x] 3.4 Manejar valores `null` como campo vacío y Decimal como número con 2 decimales

## 4. Tax payments cancel

- [x] 4.1 Agregar `@IsEnum(['CANCELLED']) status?` a `UpdateTaxPaymentDto`
- [x] 4.2 Agregar validación en `tax-payments.service.ts` update: si `dto.status === 'CANCELLED'`, validar que `existing.status === 'PAID'`; rechazar otros valores con 400
- [x] 4.3 Incluir `status` en el `updateData` cuando `dto.status !== undefined`

## 5. Owner filtering: product-costs y line-item-projection

- [x] 5.1 Agregar owner filter en `product-costs.service.ts` getMissing: filtrar `shopifyLineItem` via `shopify_order → shopify_connection → user_id`
- [x] 5.2 Agregar `@CurrentUser()` y `@Req()` a `recalculateCosts` en `reports.controller.ts`, construir ctx, pasar a `lineItemProjection.recalculateCosts()`
- [x] 5.3 Agregar owner filter en `line-item-projection.service.ts` recalculateCosts: filtrar `shopifyOrder` via `shopify_connection → user_id`

## 6. Owner filtering: getCashReport

- [x] 6.1 Agregar `employee: { ...ownerFilter }` a las 2 queries de payroll en `getCashReport` (PAID por account y pending global)
- [x] 6.2 Agregar `{ ...ownerFilter }` a las 2 queries de tax payments en `getCashReport` (PAID por account y pending global)

## 7. Shopify report i18n

- [x] 7.1 Cambiar `'Sin categoría'` → `'uncategorized'` en `shopify-profitability.service.ts`
- [x] 7.2 Cambiar `'Sin canal'` → `'no_channel'` en `shopify-profitability.service.ts` (ambas ocurrencias)

## 8. Verification

- [x] 8.1 Ejecutar linter y typecheck (`npm run lint && npm run typecheck`)
- [x] 8.2 Ejecutar tests existentes y verificar que pasan
- [x] 8.3 Verificar que `GET /reports/monthly/export?format=csv` devuelve CSV válido
- [x] 8.4 Verificar que `PATCH /tax-payments/:id` con `{ "status": "CANCELLED" }` funciona en estado PAID
