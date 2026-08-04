## ADDED Requirements

### Requirement: Reportes Shopify usan keys neutrales para categorías sin asignar

El sistema SHALL devolver `"uncategorized"` como valor de `category_name` en `GET /reports/shopify/category-profitability` y `GET /reports/shopify/product-profitability` cuando una línea de Shopify no tiene categoría resuelta. El sistema MUST NOT devolver strings localizados como `"Sin categoría"`.

#### Scenario: Categoría sin resolver devuelve key neutral

- **WHEN** un `ShopifyLineItem` tiene `category_name: null` (resolución UNKNOWN)
- **THEN** el reporte de category-profitability devuelve `category_name: "uncategorized"` y `category_source: "UNKNOWN"`

#### Scenario: Categoría resuelta no se modifica

- **WHEN** un `ShopifyLineItem` tiene `category_name: "Ropa"`
- **THEN** el reporte devuelve `category_name: "Ropa"` sin modificar

### Requirement: Reportes Shopify usan keys neutrales para canales sin asignar

El sistema SHALL devolver `"no_channel"` como valor de `channel` en `GET /reports/shopify/channel-profitability` cuando un `Income` vinculado a Shopify no tiene `channel` definido. El sistema MUST NOT devolver strings localizados como `"Sin canal"`.

#### Scenario: Canal nulo devuelve key neutral

- **WHEN** un `Income` con `shopify_order_id` no nulo tiene `channel: null`
- **THEN** el reporte de channel-profitability devuelve `channel: "no_channel"` para esa fila

#### Scenario: Canal definido no se modifica

- **WHEN** un `Income` tiene `channel: "Online Store"`
- **THEN** el reporte devuelve `channel: "Online Store"` sin modificar
