## ADDED Requirements

### Requirement: Cada producto vendido es una fila consultable

El sistema SHALL persistir una fila de `ShopifyLineItem` por cada producto vendido en cada `ShopifyOrder`, con `shopify_line_item_id`, `shopify_product_id`, `shopify_variant_id`, `sku`, `title`, `variant_title`, `quantity`, `unit_price`, `discount_allocated` y `tax_allocated`.

La unicidad SHALL garantizarse con `@@unique([shopify_order_id, shopify_line_item_id])`, de modo que reproyectar una orden no duplique líneas.

La columna `ShopifyOrder.line_items` (JSON) MUST conservarse como snapshot crudo de la respuesta de Shopify. Las consultas de reporte MUST usar las filas, no el JSON.

#### Scenario: Orden con tres productos

- **WHEN** se sincroniza una orden de Shopify con tres líneas de producto
- **THEN** el sistema crea tres filas de `ShopifyLineItem` ligadas a esa orden, y conserva el JSON original intacto

#### Scenario: Reproyección de una orden ya proyectada

- **WHEN** se reproyecta una orden que ya tiene sus líneas persistidas
- **THEN** las filas existentes se actualizan y no se crean duplicados

#### Scenario: Orden actualizada en Shopify con una línea menos

- **WHEN** una orden se reproyecta y su JSON ya no contiene una línea que sí existía como fila
- **THEN** la fila huérfana se elimina, para que los agregados no cuenten un producto que ya no está en la orden

### Requirement: Fórmula de utilidad por línea

Cada fila SHALL calcular, en el servidor y con aritmética decimal:

```
gross_sales   = unit_price × quantity
net_sales     = gross_sales - discount_allocated
total_cost    = unit_cost × quantity        (null si no hay unit_cost)
gross_profit  = net_sales - total_cost      (null si no hay total_cost)
profit_margin = gross_profit / net_sales × 100   (null si net_sales es 0 o no hay gross_profit)
```

Ninguno de estos campos MUST aceptarse del cliente.

#### Scenario: Línea con costo conocido

- **WHEN** una línea tiene `unit_price = 1200`, `quantity = 1`, `discount_allocated = 0` y `unit_cost = 900`
- **THEN** la fila queda con `gross_sales: 1200`, `net_sales: 1200`, `total_cost: 900`, `gross_profit: 300` y `profit_margin: 25`

#### Scenario: Línea con descuento

- **WHEN** una línea tiene `unit_price = 500`, `quantity = 2`, `discount_allocated = 100` y `unit_cost = 300`
- **THEN** la fila queda con `gross_sales: 1000`, `net_sales: 900`, `total_cost: 600`, `gross_profit: 300` y `profit_margin: 33.33`

#### Scenario: Línea sin costo

- **WHEN** una línea no tiene costo resoluble
- **THEN** la fila queda con `unit_cost: null`, `total_cost: null`, `gross_profit: null` y `profit_margin: null`, y sus `net_sales` siguen contando como venta

#### Scenario: Línea con venta neta cero

- **WHEN** una línea tiene un descuento que iguala su venta bruta
- **THEN** `net_sales` es `0`, `profit_margin` es `null`, y no se produce ningún error de división

### Requirement: Categoría con origen declarado

Cada fila SHALL guardar `category_name` y `category_source` (`PRODUCT_TYPE`, `COLLECTION`, `TAG`, `MANUAL`, `UNKNOWN`).

La resolución SHALL seguir esta precedencia, deteniéndose en el primer eslabón que produzca un valor:

1. `ProductCategoryOverride` del usuario para ese `shopify_product_id` → `MANUAL`
2. `product_type` de Shopify, si no está vacío → `PRODUCT_TYPE`
3. primera colección del producto, si viene en los datos → `COLLECTION`
4. primer tag del producto, si viene → `TAG`
5. `category_name = null`, `category_source = UNKNOWN`

La resolución SHALL implementarse como una función pura, sin acceso a base de datos.

#### Scenario: El override manual gana

- **WHEN** un producto tiene `product_type = "Trading Cards"` en Shopify y un override manual a `"Sellado Pokémon"`
- **THEN** la línea queda con `category_name: "Sellado Pokémon"` y `category_source: MANUAL`

#### Scenario: Product type de Shopify

- **WHEN** un producto tiene `product_type = "Accesorios"` y no tiene override
- **THEN** la línea queda con `category_name: "Accesorios"` y `category_source: PRODUCT_TYPE`

#### Scenario: Sin ningún dato de categoría

- **WHEN** un producto no tiene override, ni `product_type`, ni colecciones, ni tags
- **THEN** la línea queda con `category_name: null` y `category_source: UNKNOWN`, y el reporte la agrupa bajo una categoría `Sin categoría` visible

#### Scenario: Product type vacío no cuenta como valor

- **WHEN** un producto tiene `product_type = ""` y un tag `"Singles"`
- **THEN** la línea queda con `category_name: "Singles"` y `category_source: TAG`

### Requirement: Override manual de categoría

El sistema SHALL exponer `POST`, `GET`, `PATCH` y `DELETE` sobre `/product-category-overrides`, protegidos por los permisos `product_category_override:<action>`.

Un override SHALL ser único por `(user_id, shopify_product_id)`.

Crear, cambiar o borrar un override MUST NOT reescribir por sí solo las líneas ya proyectadas: la reasignación de categoría ocurre en la reproyección, que el usuario dispara explícitamente.

#### Scenario: Crear un override

- **WHEN** se envía `POST /product-category-overrides` con `{ "shopify_product_id": "77123", "category_name": "Sellado Pokémon" }`
- **THEN** el sistema responde `201 Created`

#### Scenario: Override duplicado

- **WHEN** se crea un override para un `shopify_product_id` que ya tiene uno del mismo usuario
- **THEN** el sistema responde `409 Conflict`

#### Scenario: El override no reescribe el pasado por sí solo

- **WHEN** se crea un override y se consulta el reporte de rentabilidad sin reproyectar
- **THEN** las líneas históricas conservan su categoría anterior, y la respuesta indica que hay overrides sin aplicar

### Requirement: Backfill de las órdenes ya sincronizadas

El sistema SHALL proveer `scripts/backfill-line-items.ts`, que recorre las `ShopifyOrder` existentes y proyecta sus líneas desde el JSON almacenado, **sin llamar a la API de Shopify**.

El backfill MUST ser idempotente y MUST procesar las órdenes por lotes.

Una orden cuyo JSON no se pueda interpretar MUST registrarse en un reporte de errores con su `id` y su `external_order_id`, y el lote MUST continuar con las demás. El script MUST NOT abortar el proceso completo por una orden ilegible, ni omitirla en silencio.

#### Scenario: Backfill de órdenes históricas

- **WHEN** se ejecuta el backfill sobre 500 órdenes ya sincronizadas
- **THEN** se crean las filas de línea correspondientes, y el script informa cuántas órdenes procesó y cuántas líneas creó

#### Scenario: Backfill ejecutado dos veces

- **WHEN** se ejecuta el backfill dos veces seguidas
- **THEN** la segunda ejecución no crea líneas duplicadas

#### Scenario: JSON con formato inesperado

- **WHEN** una orden tiene un `line_items` que no coincide con la estructura esperada
- **THEN** el script la registra como error con su identificador, continúa con las siguientes, y termina informando el número de órdenes no proyectadas

### Requirement: La proyección ocurre al sincronizar una orden

Después de persistir o actualizar una `ShopifyOrder`, la sincronización SHALL proyectar sus líneas.

La proyección MUST ejecutarse en la misma transacción que la escritura de la orden, para que no exista una orden persistida sin sus líneas.

La proyección MUST NOT modificar el flujo de webhooks, OAuth ni backfill de la integración de Shopify: se añade como paso posterior a la persistencia de la orden.

#### Scenario: Orden nueva vía webhook

- **WHEN** llega un webhook de orden y la sincronización la persiste
- **THEN** las filas de línea quedan creadas en la misma transacción

#### Scenario: Fallo de la proyección

- **WHEN** la proyección falla al procesar una orden nueva
- **THEN** la transacción se revierte completa y la orden no queda persistida sin líneas

### Requirement: Los totales de la orden se derivan de sus líneas

Tras proyectar las líneas de una orden, el sistema SHALL recalcular en `ShopifyOrder`:

```
cost_total            = suma de total_cost de sus líneas
profit_total          = suma de gross_profit de sus líneas con costo
has_missing_cost_data = true si alguna línea no tiene costo
```

Y SHALL propagar a los `Income` ligados a esa orden sus `cogs_total` y `profit_gross`, coherentes con la capacidad `cogs-tracking` de MVP 1.

#### Scenario: Orden con costo completo

- **WHEN** una orden tiene dos líneas con costo por `900` y `300`
- **THEN** la orden queda con `cost_total: 1200` y `has_missing_cost_data: false`

#### Scenario: Orden con una línea sin costo

- **WHEN** una orden tiene una línea con costo `900` y otra sin costo
- **THEN** la orden queda con `cost_total: 900`, `has_missing_cost_data: true`, y el reporte cuenta la segunda línea como venta sin costo

#### Scenario: Propagación al ingreso

- **WHEN** una orden con `cost_total: 1200` tiene un `Income` asociado con `net_amount: 2000`
- **THEN** el ingreso queda con `cogs_total: 1200` y `profit_gross: 800`
