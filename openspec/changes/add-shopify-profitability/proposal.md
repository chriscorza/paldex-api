## Why

Con `add-financial-model-core` la API ya responde cuánto ganó Corszas el mes pasado. Lo que sigue sin poder responder es **de dónde salió esa ganancia**:

> ¿Qué categoría de productos deja más dinero real? ¿En qué estamos vendiendo mucho y ganando poco?

Hoy es imposible por dos razones concretas. Primero, `ShopifyOrder.line_items` es una **columna JSON**: cada producto vendido está ahí, pero no se puede agrupar, sumar ni filtrar por él en SQL — sólo cargarlo todo en memoria y recorrerlo. Segundo, el costo se captura **por venta**, a mano, una y otra vez: nadie va a teclear el costo del mismo ETB cuarenta veces en un mes, así que la cobertura de costo se queda baja y el reporte de rentabilidad, incompleto por construcción.

Y la pregunta importa porque la intuición engaña. Una categoría que vende $100 000 y deja $10 000 es peor negocio que una que vende $40 000 y deja $18 000, y un ranking por ventas brutas —el único que la API puede producir hoy— pone la primera arriba.

## What Changes

### Los line items salen del JSON y pasan a ser filas

- Nuevo modelo `ShopifyLineItem`, una fila por producto vendido en cada orden, con `shopify_line_item_id`, `shopify_product_id`, `shopify_variant_id`, `sku`, `title`, `variant_title`, `quantity`, `unit_price`, `discount_allocated`, `tax_allocated`, y el bloque de costo y utilidad calculados: `unit_cost`, `total_cost`, `gross_sales`, `net_sales`, `gross_profit`, `profit_margin`.
- La columna `ShopifyOrder.line_items` (JSON) **se conserva** como snapshot crudo de lo que Shopify devolvió — es evidencia, no fuente de consulta. Las filas de `ShopifyLineItem` se derivan de ella.
- **Backfill**: las órdenes ya sincronizadas se reproyectan desde su JSON a filas, sin volver a llamar a Shopify.

### Categoría por línea, con origen declarado

- Cada línea guarda `category_name` y `category_source` (`PRODUCT_TYPE`, `COLLECTION`, `TAG`, `MANUAL`, `UNKNOWN`).
- La resolución sigue una **cadena de precedencia** fija: override manual en paldex → `product_type` de Shopify → primera colección → primer tag → `UNKNOWN`. El `category_source` dice qué eslabón ganó, así que una categoría nunca aparece sin que se sepa de dónde vino.
- Nuevo modelo `ProductCategoryOverride`: mapeo manual `shopify_product_id → category_name`, para cuando los datos de Shopify no están limpios. Gana siempre sobre lo que diga Shopify.

### Costo por producto, capturado una vez

- Nuevo modelo `ProductCost`: costo por `shopify_variant_id` o por `sku`, con `unit_cost`, `effective_from`, `source` (`MANUAL`, `SHOPIFY_INVENTORY`, `IMPORTED`) y `notes`.
- **Histórico por fecha de vigencia**: una orden usa el `ProductCost` vigente a su fecha, no el costo de hoy. Cambiar el costo de un producto no reescribe la utilidad de órdenes pasadas.
- Precedencia de costo por línea: costo congelado en la orden al sincronizar → `ProductCost` por `variant_id` → `ProductCost` por `sku` → sin costo.
- **Carga masiva** vía `POST /product-costs/bulk`: lista de `sku`/`variant_id` con su costo. Es la diferencia entre capturar cuarenta costos y capturar uno.
- `GET /product-costs/missing` lista los productos vendidos en un periodo que no tienen costo, ordenados por ventas netas — la lista de trabajo para subir la cobertura donde más pesa.

### Reporte de rentabilidad por categoría

- `GET /reports/shopify/category-profitability?start_date&end_date` — por categoría: unidades vendidas, órdenes, ventas brutas, descuentos, ventas netas, COGS, utilidad bruta, margen bruto %, participación en la utilidad total, número de líneas sin costo y `incomplete_cost_data`.
- Orden por defecto: **mayor utilidad bruta primero**. Ordenable también por ventas netas, margen %, unidades y líneas sin costo.
- Tarjetas destacadas en la misma respuesta: categoría con más utilidad en pesos, con mejor margen, con más ventas netas, y las que tienen costos faltantes. Son dos preguntas distintas —"qué deja más dinero" y "qué deja mejor margen"— y el reporte contesta las dos.
- `GET /reports/shopify/product-profitability` — el mismo cálculo a nivel de producto/SKU, con filtro opcional por categoría para bajar al detalle.
- `GET /reports/shopify/channel-profitability` — utilidad por canal y por pasarela de pago.

### La cobertura de costo se mide y se declara

- Ninguna respuesta oculta una venta por falta de costo. Cada agregado expone `missing_cost_items`, `sales_without_cost` e `incomplete_cost_data`.
- El reporte separa `gross_profit_confirmed` (sólo líneas con costo) de las ventas sin costear, igual que hace el estado mensual de MVP 1.

### El costo por línea se recalcula cuando aparece el dato

- `POST /shopify/recalculate-costs?start_date&end_date` reproyecta costo y utilidad de las líneas del periodo a partir de los `ProductCost` vigentes, y propaga el resultado a `ShopifyOrder.cost_total`/`profit_total` y a `Income.cogs_total`/`profit_gross`.
- Es idempotente y es la razón por la que capturar un costo tarde no deja el histórico roto para siempre.

### No incluido (non-goals)

- **Nada de frontend.** La pantalla `/reportes/shopify/categorias` que el plan describe no se construye aquí.
- **No se cambia el flujo de sincronización de Shopify.** No se tocan webhooks, ni backfill, ni OAuth. Este change **extiende** lo que la sincronización persiste; el disparo y la entrega siguen siendo de `add-shopify-integration`.
- **No se lee el costo desde la API de Shopify en este change.** `ProductCost` admite `source: SHOPIFY_INVENTORY` en el modelo, pero traer `InventoryItem.unitCost` por GraphQL queda para después: hoy el costo entra a mano o por carga masiva.
- **No hay inventario.** Sin existencias, sin costo promedio ponderado, sin valuación.
- **No se modelan colecciones de Shopify como entidad.** La colección se resuelve a un nombre de categoría al sincronizar y se guarda como texto en la línea.
- **No se reparte el envío ni las comisiones entre líneas.** La utilidad por línea es `ventas netas de línea − costo de línea`; el envío absorbido y las comisiones siguen viviendo a nivel de orden e ingreso.
- **No se toca el estado de resultados mensual.** Este change alimenta `Income.cogs_total` con mejor cobertura, y por eso el estado mensual mejora solo, pero sus fórmulas no cambian.
- **Cierre mensual, comparación de periodos y exportaciones** → `add-monthly-operations`.

## Capabilities

### New Capabilities
- `shopify-line-items`: la persistencia relacional de los productos vendidos por orden, su reproyección desde el JSON existente, y la resolución de categoría con origen declarado.
- `product-costs`: el catálogo de costos por producto o SKU con vigencia por fecha, su carga masiva, la precedencia de resolución de costo por línea, y la recalculación idempotente de utilidad cuando el costo aparece tarde.
- `shopify-profitability-reports`: los reportes de rentabilidad por categoría, por producto/SKU y por canal, con sus tarjetas destacadas y su medición explícita de cobertura de costo.

### Modified Capabilities
<!-- Ninguna. Las capacidades de MVP 1 (`cogs-tracking`, `financial-reports`) consumen datos mejores sin cambiar sus requisitos, y la sincronización de Shopify se extiende sin modificar su contrato. -->

## Impact

**Depende de**: `add-financial-model-core` (MVP 1) — usa `Income.cogs_total`, `Income.profit_gross`, la aritmética decimal de `src/common/money.ts` y el permiso `report:read`. Y de `add-shopify-integration`, que ya produce `ShopifyOrder` con su JSON de líneas.

**Base de datos** — migración:
- `ShopifyLineItem`: `id`, `shopify_order_id`, `shopify_line_item_id`, `shopify_product_id?`, `shopify_variant_id?`, `sku?`, `title`, `variant_title?`, `quantity`, `unit_price`, `discount_allocated`, `tax_allocated`, `category_name?`, `category_source`, `unit_cost?`, `total_cost?`, `gross_sales`, `net_sales`, `gross_profit?`, `profit_margin?`, con `@@unique([shopify_order_id, shopify_line_item_id])`.
- `ProductCost`: `id`, `shopify_variant_id?`, `sku?`, `unit_cost`, `effective_from`, `source`, `notes?`, `user_id`, con índices por `shopify_variant_id` y por `sku`.
- `ProductCategoryOverride`: `id`, `shopify_product_id`, `category_name`, `user_id`, con `@@unique([user_id, shopify_product_id])`.
- Todas las columnas monetarias en `Decimal(14,2)`, coherente con MVP 1.
- Índices de reporte: `ShopifyLineItem(category_name)`, `ShopifyLineItem(sku)`, `ShopifyLineItem(shopify_variant_id)`.

**Código nuevo**
- `src/shopify/line-item-projection.service.ts` — proyecta el JSON de una orden a filas, resuelve categoría y costo.
- `src/shopify/category-resolver.ts` — la cadena de precedencia de categoría, unidad pura.
- `src/shopify/cost-resolver.ts` — la cadena de precedencia de costo, unidad pura.
- `src/product-costs/` — módulo de catálogo de costos y de overrides de categoría.
- `src/reports/shopify-profitability.service.ts` — las agregaciones de rentabilidad.
- `scripts/backfill-line-items.ts` — reproyección de las órdenes ya sincronizadas.

**Código modificado**
- `src/shopify/` — el servicio de sincronización llama a la proyección de líneas después de persistir una orden.
- `src/reports/` — nuevo controlador de reportes de Shopify.
- `src/permissions/permission-catalog.ts` — permisos `product_cost` y `product_category_override`.
- `src/app.module.ts` — registrar el módulo nuevo.

**Contrato de API**: puramente aditivo. Endpoints nuevos; ninguno existente cambia de forma.

**Dependencias**: ninguna nueva en `package.json`.

**Riesgo principal**: el backfill reproyecta el JSON de órdenes históricas. Si el formato del JSON varió entre versiones de la sincronización, la proyección tiene que tolerarlo y registrar las órdenes que no puede interpretar en vez de fallar en silencio o abortar el lote completo.
