## 1. Esquema y permisos

- [x] 1.1 Añadir a `prisma/schema.prisma` el modelo `InventorySnapshot` (`shopify_connection_id`, `user_id`, `taken_at`, `status`, `total_units`, `total_cost`, `products_valued`, `products_without_cost`, `variants_untracked`, `created_at`) con índices por `user_id` y por `taken_at`, y el enum `InventorySnapshotStatus` (`PENDING`, `COMPLETE`, `FAILED`). Dinero en `Decimal(14,2)`.
- [x] 1.2 Añadir el modelo `InventorySnapshotItem` (`snapshot_id`, `shopify_variant_id`, `shopify_inventory_item_id`, `sku`, `title`, `location_name`, `quantity_on_hand` nullable, `tracked`, `unit_cost` nullable, `total_cost` nullable, `cost_source` nullable) con borrado en cascada desde el snapshot e índices por `snapshot_id` y por `shopify_variant_id`.
- [x] 1.3 Generar la migración con `docker exec paldex-api-1 npx prisma migrate dev --create-only` y revisar el SQL: debe ser aditivo, sin tocar tablas existentes.
- [x] 1.4 Añadir `inventory:read`, `inventory:read` con `scope: 'OWN'`, `inventory:sync` e `inventory:sync` con `scope: 'OWN'` a `PERMISSION_CATALOG` en `src/permissions/permission-catalog.ts`.

## 2. Captura de existencias desde Shopify

- [x] 2.1 Crear `src/shopify/shopify-inventory-sync.service.ts` con la consulta `productVariants(first: 250, after: $cursor)` que pide `id`, `sku`, `title`, `product { id title }` e `inventoryItem { id tracked unitCost { amount } inventoryLevels(first: 10) { edges { node { location { name } quantities(names: ["on_hand"]) { name quantity } } } } }`.
- [x] 2.2 Implementar la paginación por `pageInfo.hasNextPage` / `endCursor` con tope de páginas, devolviendo una lista plana de renglones variante × sucursal.
- [x] 2.3 Comprobar antes de consultar que `ShopifyConnection.scope` incluya `read_inventory`; si falta, lanzar un error que identifique la conexión y diga que hay que reinstalarla, sin llamar a Shopify.
- [x] 2.4 Mapear cada renglón: `on_hand` (nunca `available`) a `quantity_on_hand`, `tracked: false` a `quantity_on_hand: null`, y conservar existencias negativas tal cual.
- [x] 2.5 Registrar el servicio en `src/shopify/shopify.module.ts` y exportarlo.
- [x] 2.6 Pruebas de `ShopifyInventorySyncService`: paginación de varias páginas, variante sin rastreo, existencia negativa, varias sucursales, y el rechazo por scope faltante.

## 3. Valuación y persistencia de la foto

- [x] 3.1 Crear `src/inventory/inventory-snapshot.service.ts` que cree el snapshot en `PENDING`, escriba los renglones y lo cierre en `COMPLETE`; ante cualquier fallo lo deje en `FAILED` sin propagarlo como foto válida.
- [x] 3.2 Implementar la resolución de costo por renglón: `ProductCost` del dueño por `shopify_variant_id` → por `sku` → `inventoryItem.unitCost`, tomando el `effective_from` vigente más reciente que no sea posterior a `taken_at`. Documentar en un comentario el paralelo con `resolveLineItemCost` y por qué no se reutiliza.
- [x] 3.3 Congelar `unit_cost`, `total_cost` (`unit_cost` × piezas) y `cost_source` en el renglón al capturar; dejar los dos costos nulos —nunca cero— cuando no haya costo disponible.
- [x] 3.4 Sembrar `ProductCost` con `source: SHOPIFY_INVENTORY` cuando Shopify traiga `unitCost` y el dueño no tenga renglón para esa variante.
- [x] 3.5 Calcular y guardar en el snapshot los totales: `total_units`, `total_cost`, `products_valued`, `products_without_cost`, `variants_untracked`.
- [x] 3.6 Pruebas del servicio: precedencia de costo en sus tres casos, costo con `effective_from` futuro ignorado, renglón sin costo alguno, existencia desconocida fuera del total, negativa dentro del total, y la foto que queda `FAILED` si la captura se cae a la mitad.

## 4. Reporte de avalúo

- [x] 4.1 Crear `src/inventory/inventory-valuation.service.ts`: elige la foto (la más reciente `COMPLETE` del dueño, o la indicada por `snapshot_id`, o la más reciente en o antes de `as_of`), agrupa los renglones por producto sumando sucursales, y ordena de mayor a menor `total_cost`.
- [x] 4.2 Calcular los totales del avalúo sobre el reporte completo —nunca sobre la página— incluyendo la cobertura como porcentaje de piezas conocidas que quedaron valuadas, con `percentage()` de `src/common/money.ts` para que sea nula sin existencias.
- [x] 4.3 Responder con un error claro —no con totales en cero— cuando el dueño no tenga ninguna foto `COMPLETE`, indicando cómo tomar la primera.
- [x] 4.4 Crear `src/inventory/dto/inventory-valuation-query.dto.ts` (`snapshot_id`, `as_of`, `sort_by`, `order`, `page`, `limit`) y `src/inventory/entities/inventory-valuation.entity.ts` con `@ApiProperty` documentando cada campo, incluido que el avalúo no es costeo PEPS.
- [x] 4.5 Exponer `GET /reports/inventory-valuation` en `src/reports/reports.controller.ts` con `@ApiOperation` que diga explícitamente en qué se diferencia de `GET /reports/inventory-cost`, y proyectar el dinero a número con `toMoneyNumber()`.
- [x] 4.6 Pruebas del servicio de valuación: orden por costo total, suma de sucursales en un solo renglón, elección de foto por `as_of`, cobertura parcial, totales independientes de la paginación, y el caso sin ninguna foto.

## 5. Endpoints de captura e histórico

- [x] 5.1 Crear `src/inventory/inventory.controller.ts` con `POST /inventory/snapshots` (`@RequirePermissions('inventory:sync')`), que capture las conexiones activas del dueño y devuelva la foto con sus totales; error explícito si el dueño no tiene conexión activa.
- [x] 5.2 Añadir `GET /inventory/snapshots` (`@RequirePermissions('inventory:read')`), que liste las fotos del dueño de la más reciente a la más antigua con sus totales.
- [x] 5.3 Crear `src/inventory/inventory.module.ts`, registrarlo en `src/app.module.ts` e importar lo que haga falta de `ShopifyModule`.
- [x] 5.4 Verificar el filtrado por dueño en las dos lecturas con `buildOwnerFilter`, y probar que con alcance propio no se ven ni se capturan las conexiones de otro dueño.

## 6. Captura automática

- [x] 6.1 Añadir a `src/jobs/scheduled-jobs.service.ts` un cron `15 6 * * *` en `reportsTimeZone()` que recorra los dueños con conexión activa y tome una foto por cada uno con `scope: 'OWN'`, respetando `SCHEDULED_JOBS_ENABLED` leído en tiempo de llamada.
- [x] 6.2 Aislar el fallo de un dueño para que no detenga a los demás, registrando el error con el `Logger` como hacen los otros trabajos.
- [x] 6.3 Pruebas del cron: corre por dueño y no globalmente, un dueño que falla no impide los demás, y no corre con los trabajos deshabilitados.

## 7. Cierre

- [x] 7.1 Documentar en `paldex-api/CLAUDE.md` la sección de avalúo de inventario: qué es y qué no es, la precedencia de costo, `on_hand` frente a `available`, existencia desconocida frente a cero, por qué las fotos son históricas y por qué el costo se congela al capturar.
- [x] 7.2 Añadir a `src/shopify/CLAUDE.md` la nota del scope `read_inventory` y qué hacer con las conexiones instaladas sin él.
- [x] 7.3 Correr `npx jest`, `npx tsc --noEmit --incremental false -p tsconfig.json` y `npx eslint` sobre los archivos nuevos; todo en verde.
- [x] 7.4 Verificar el contrato en `/api-docs`: los cuatro endpoints nuevos aparecen con sus DTOs y entidades resueltos, sin tipos inline.
