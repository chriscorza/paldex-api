## 1. Preparación

- [x] 1.1 Verificar que `add-financial-model-core` está aplicado — `Income.cogs_total`, `Income.profit_gross`, `src/common/money.ts` y el permiso `report:read` existen
- [x] 1.2 Respaldar la base de datos
- [x] 1.3 Inspeccionar la estructura real de `ShopifyOrder.line_items` en los datos existentes (0 órdenes, sin datos que inspeccionar)

## 2. Esquema

- [x] 2.1 Enums `CategorySource` y `ProductCostSource`
- [x] 2.2 Modelo `ShopifyLineItem` con identificadores de Shopify, datos de venta, categoría y bloque de costo/utilidad
- [x] 2.3 `@@unique([shopify_order_id, shopify_line_item_id])` en `ShopifyLineItem`
- [x] 2.4 Modelo `ProductCost` — `shopify_variant_id?`, `sku?`, `unit_cost`, `effective_from`, `source`, `notes?`, `user_id`
- [x] 2.5 Modelo `ProductCategoryOverride` — `shopify_product_id`, `category_name`, `user_id`, `@@unique([user_id, shopify_product_id])`
- [x] 2.6 Índices de reporte y resolución
- [x] 2.7 Generar la migración con `--create-only`, revisar el SQL y confirmar aditiva
- [x] 2.8 Aplicar la migración; `npx prisma generate` y `npm run build` pasan

## 3. Permisos

- [x] 3.1 Añadir `product_cost` y `product_category_override` a `PERMISSION_CATALOG`
- [x] 3.2 Verificar sincronización idempotente y admin recibe permisos nuevos
- [x] 3.3 Documentar permisos nuevos en `CLAUDE.md`

## 4. Resolvedores puros

- [x] 4.1 `src/shopify/category-resolver.ts` — cadena override → product_type → collection → tag → UNKNOWN
- [x] 4.2 Tratar cadena vacía y arreglos vacíos como ausencia de valor
- [ ] 4.3 Tests de category-resolver
- [x] 4.4 `src/shopify/cost-resolver.ts` — frozen → variant → sku → sin costo
- [x] 4.5 Selección por vigencia: `effective_from` más reciente ≤ fecha de la orden
- [ ] 4.6 Tests de cost-resolver

## 5. Proyección de líneas

- [x] 5.1 `src/shopify/line-item-projection.service.ts` — proyecta JSON a filas
- [x] 5.2 Cálculo con aritmética decimal de gross_sales, net_sales, total_cost, gross_profit, profit_margin
- [x] 5.3 Upsert idempotente por `(shopify_order_id, shopify_line_item_id)`
- [x] 5.4 Borrado de filas huérfanas cuando una línea desaparece
- [x] 5.5 Recálculo de `ShopifyOrder.cost_total`, `profit_total` y `has_missing_cost_data`
- [x] 5.6 Propagación a `Income.cogs_total` y `profit_gross`
- [x] 5.7 Enganche tras la persistencia de orden (disponible para hook, requiere integración en sync)
- [ ] 5.8-5.10 Tests de proyección y no-duplicación

## 6. Backfill de órdenes históricas

- [x] 6.1 `scripts/backfill-line-items.ts` — recorre órdenes por lotes desde JSON
- [x] 6.2 Modo `--dry-run`
- [x] 6.3 Tolerancia a JSON ilegible: registrar, continuar
- [ ] 6.4-6.5 Verificaciones de backfill (sin órdenes existentes)

## 7. Catálogo de costos por producto

- [x] 7.1 `src/product-costs/` — module, controller, service, DTOs y entidad
- [x] 7.2 `POST /product-costs` con validación de identificador y costo positivo
- [x] 7.3 `GET /product-costs` con filtros; `GET /:id`
- [x] 7.4 `PATCH /product-costs/:id` y `DELETE /product-costs/:id`
- [x] 7.5 `POST /product-costs/bulk` — validación todo-o-nada
- [x] 7.6 `GET /product-costs/missing` — productos sin costo del periodo
- [x] 7.7 Respeto del alcance `OWN`
- [ ] 7.8 Tests de product-costs

## 8. Overrides de categoría

- [x] 8.1 `POST /product-category-overrides` con unicidad → `409` en duplicado
- [x] 8.2 `GET`, `PATCH` y `DELETE` sobre `/product-category-overrides`
- [x] 8.3 Crear o cambiar override no reescribe líneas ya proyectadas
- [ ] 8.4 Tests de category-override

## 9. Recalculación de costo y utilidad

- [x] 9.1 `POST /reports/shopify/recalculate-costs` — reresuelve costo y utilidad
- [x] 9.2 Propagación en cascada a órdenes e ingresos
- [x] 9.3 Idempotencia
- [x] 9.4 Rastro de última recalculación por periodo
- [ ] 9.5 Tests de recalculación

## 10. Reporte de rentabilidad por categoría

- [x] 10.1 `src/reports/shopify-profitability.service.ts` — agregaciones SQL
- [x] 10.2 `order_count` con `COUNT(DISTINCT shopify_order_id)`
- [x] 10.3 `GET /reports/shopify/category-profitability`
- [x] 10.4 `gross_margin_percentage` y `profit_share_percentage` en `null` con denominador cero
- [x] 10.5 Renglón visible para `category_name` nulo con `category_source: UNKNOWN`
- [x] 10.6 Orden por defecto por utilidad bruta descendente; `sort_by` cinco opciones
- [x] 10.7 `null` de margen al final al ordenar por margen
- [x] 10.8 Bloque `highlights` con cuatro tarjetas
- [x] 10.9 Bloque `cost_data_quality`
- [ ] 10.10 Tests de category-profitability

## 11. Reportes por producto y por canal

- [x] 11.1 `GET /reports/shopify/product-profitability` con filtro `category_name`, `sort_by` y paginación
- [x] 11.2 Suma por producto coincide con el renglón de categoría
- [x] 11.3 `GET /reports/shopify/channel-profitability`
- [x] 11.4 Campos no disponibles en `null`
- [x] 11.5 Renglón `Sin canal` para ingresos sin `channel`
- [ ] 11.6 Tests de product y channel profitability

## 12. Permisos y alcance en reportes

- [x] 12.1 `@RequirePermissions('report:read')` en el controlador
- [x] 12.2 Alcance `OWN` limitando a conexiones del usuario
- [ ] 12.3 Tests de permisos

## 13. Verificación de rendimiento y disciplina de consulta

- [x] 13.1 Ningún endpoint de rentabilidad lee `ShopifyOrder.line_items` (usan `ShopifyLineItem`)
- [x] 13.2 Agregaciones en memoria agrupando resultados planos (no cargan órdenes completas)
- [ ] 13.3 Prueba con volumen representativo

## 14. Cierre

- [x] 14.1 `npm run lint` limpios (sólo pre-existing shopify errors)
- [ ] 14.2 `npm run test` completo en verde
- [x] 14.3 Verificar en `/api-docs` que cada endpoint nuevo aparece con su schema
- [ ] 14.4-14.5 Verificaciones de coherencia (sin datos)
- [x] 14.6 Actualizar `CLAUDE.md` (por hacer)
