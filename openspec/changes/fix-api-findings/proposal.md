## Why

El frontend identificó 6 hallazgos en el API durante el análisis de integración: el export CSV no funciona, payables/receivables no tienen DTOs (riesgo de seguridad), receivables no puede eliminar cobros, los tax payments no se pueden cancelar, faltan filtros de owner en product-costs y cash report, y los reportes de Shopify devuelven strings en español hardcodeados. Estos bugs y omisiones bloquean funcionalidad del frontend y rompen la consistencia con el resto del API.

## What Changes

- **`GET /reports/monthly/export?format=csv`** genera un CSV real con headers y datos del ProfitReport, en lugar de devolver JSON.
- **Payables y receivables** obtienen DTOs tipados con `class-validator` para create y update, reemplazando `@Body() d: any`. Los updates usan whitelist de campos en lugar de pasar el body crudo a Prisma.
- **Receivables** gana `DELETE /receivables/collections/:id` para eliminar cobros, igualando la funcionalidad de payables.
- **Tax payments** aceptan `status` en `PATCH /tax-payments/:id`, permitiendo pasar de `PAID` a `CANCELLED`. Se valida que solo se pueda cancelar si está en estado `PAID`.
- **Filtros de owner** se agregan a `getMissing`, `recalculateCosts` y a las 4 queries de `getCashReport` que actualmente suman datos de todos los usuarios.
- **Reportes Shopify** usan keys neutrales (`uncategorized`, `no_channel`) en lugar de strings en español hardcodeados. El frontend se encarga de la traducción.

## Capabilities

### New Capabilities
- `reports-csv-export`: Exportar el reporte mensual (`ProfitReport`) como archivo CSV descargable.
- `payables-receivables-dtos`: Validación tipada con DTOs para payables y receivables, y endpoint `DELETE /receivables/collections/:id`.
- `shopify-report-i18n`: Usar keys neutrales en reportes de Shopify en lugar de strings localizados hardcodeados.

### Modified Capabilities
- `data-ownership`: Extender el filtrado por owner a `getMissing`, `recalculateCosts` y las queries internas de `getCashReport` (payroll y tax payments).
- `taxes-crud`: Extender `PATCH /tax-payments/:id` para aceptar `status: "CANCELLED"`, permitiendo cancelar un tax payment pagado.

## Impact

- **Controllers**: `reports.controller.ts` (export CSV), `receivables.controller.ts` (nuevo endpoint delete collection)
- **Services**: `reports-aggregation.service.ts` (owner filters en getCashReport), `product-costs.service.ts` (owner filter en getMissing), `line-item-projection.service.ts` (owner filter en recalculateCosts), `shopify-profitability.service.ts` (keys neutrales), `tax-payments.service.ts` (cancel via status), `payables.service.ts`, `receivables.service.ts` (whitelist en update)
- **DTOs**: Nuevos archivos en `src/payables/dto/` y `src/receivables/dto/`, modificación de `UpdateTaxPaymentDto`
- **Permissions**: Nueva entrada `receivable:delete_collection` en el catálogo
- **Breaking**: `GET /reports/monthly/export?format=csv` cambia de devolver JSON a devolver `text/csv` (solo cuando se pasa `format=csv`). Sin `format`, el comportamiento sin cambios. Reportes Shopify devuelven keys distintas para uncategorized/unmapped — el frontend deberá mapear las nuevas keys.
