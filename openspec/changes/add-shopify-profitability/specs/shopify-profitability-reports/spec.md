## ADDED Requirements

### Requirement: Rentabilidad por categoría

El sistema SHALL exponer `GET /reports/shopify/category-profitability?start_date&end_date`, protegido por `report:read`.

La respuesta SHALL contener un renglón por categoría con esta forma:

```ts
type ShopifyCategoryProfitability = {
  category_name: string;
  category_source: 'PRODUCT_TYPE' | 'COLLECTION' | 'TAG' | 'MANUAL' | 'UNKNOWN';
  units_sold: number;
  order_count: number;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  cogs: number;
  gross_profit: number;
  gross_margin_percentage: number | null;
  profit_share_percentage: number | null;
  missing_cost_items: number;
  incomplete_cost_data: boolean;
};
```

Las fórmulas por categoría SHALL ser:

```
net_sales               = suma de net_sales de sus líneas
cogs                    = suma de total_cost de sus líneas con costo
gross_profit            = suma de gross_profit de sus líneas con costo
gross_margin_percentage = gross_profit / net_sales × 100
profit_share_percentage = gross_profit / utilidad bruta total del periodo × 100
order_count             = número de órdenes distintas con al menos una línea de la categoría
```

`order_count` cuenta órdenes distintas, no líneas: una orden con tres productos de la misma categoría cuenta una vez.

#### Scenario: Reporte con dos categorías

- **WHEN** el periodo tiene una categoría con `net_sales = 100000` y `gross_profit = 10000`, y otra con `net_sales = 40000` y `gross_profit = 18000`
- **THEN** la primera devuelve `gross_margin_percentage: 10` y la segunda `45`, y las participaciones suman `100`

#### Scenario: Orden con varios productos de la misma categoría

- **WHEN** una orden contiene tres líneas de la misma categoría
- **THEN** `order_count` de esa categoría cuenta esa orden una sola vez, y `units_sold` suma las tres cantidades

#### Scenario: Categoría sin costos capturados

- **WHEN** una categoría tiene ventas netas y ninguna línea con costo
- **THEN** devuelve `cogs: 0`, `gross_profit: 0`, `gross_margin_percentage: null`, `incomplete_cost_data: true` y `missing_cost_items` igual a su número de líneas

#### Scenario: Líneas sin categoría

- **WHEN** el periodo incluye líneas con `category_name: null`
- **THEN** el reporte las agrupa en un renglón visible con `category_source: UNKNOWN`, y no las omite

#### Scenario: Periodo sin ventas

- **WHEN** se pide el reporte de un periodo sin líneas
- **THEN** la respuesta es `200 OK` con una lista vacía y las tarjetas destacadas en `null`

#### Scenario: Rango de fechas inválido

- **WHEN** se pide el reporte con `start_date` posterior a `end_date`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Orden por defecto y órdenes alternativos

El reporte SHALL ordenarse por defecto por **utilidad bruta descendente**.

`sort_by` SHALL aceptar `gross_profit`, `net_sales`, `gross_margin_percentage`, `units_sold` y `missing_cost_items`, y `order` SHALL aceptar `asc` y `desc`. Un valor no permitido MUST responder `400 Bad Request`.

Las categorías con `gross_margin_percentage: null` MUST quedar al final cuando se ordena por margen, no al principio.

#### Scenario: Orden por defecto

- **WHEN** se pide el reporte sin `sort_by`
- **THEN** la categoría con mayor utilidad bruta en pesos aparece primero

#### Scenario: Orden por margen con categorías sin costo

- **WHEN** se pide `sort_by=gross_margin_percentage&order=desc` y hay categorías sin costo capturado
- **THEN** las categorías con margen conocido se ordenan de mayor a menor, y las de margen `null` quedan al final

#### Scenario: Orden por costos faltantes

- **WHEN** se pide `sort_by=missing_cost_items&order=desc`
- **THEN** la categoría con más líneas sin costo aparece primero

### Requirement: Tarjetas destacadas en la misma respuesta

La respuesta SHALL incluir un bloque `highlights` con:

```
top_by_gross_profit      la categoría que deja más dinero en pesos
top_by_margin            la categoría con mejor margen bruto
top_by_net_sales         la categoría con más ventas netas
categories_missing_cost  las categorías con incomplete_cost_data
```

`top_by_gross_profit` y `top_by_margin` SHALL exponerse por separado incluso cuando coincidan, porque son dos preguntas distintas: cuál deja más dinero y cuál deja mejor porcentaje.

Cuando el periodo no tiene datos suficientes para una tarjeta, su valor MUST ser `null`.

#### Scenario: Las dos mejores categorías no coinciden

- **WHEN** la categoría A deja `10000` con margen `10 %` y la B deja `18000` con margen `45 %`
- **THEN** `top_by_gross_profit` y `top_by_margin` son ambas la categoría B, y `top_by_net_sales` es la A

#### Scenario: Más ventas no es más ganancia

- **WHEN** la categoría A vende `100000` netos dejando `10000`, y la B vende `40000` netos dejando `18000`
- **THEN** `top_by_net_sales` es la A y `top_by_gross_profit` es la B, dejando visible la diferencia

#### Scenario: Sin margen calculable en ninguna categoría

- **WHEN** ninguna categoría del periodo tiene costo capturado
- **THEN** `top_by_margin` es `null` y `categories_missing_cost` lista todas

### Requirement: Cobertura de costo declarada a nivel de reporte

La respuesta SHALL incluir un bloque `cost_data_quality` con:

```
total_line_items
line_items_with_cost
missing_cost_items
sales_without_cost
cost_data_coverage        porcentaje de ventas netas con costo
gross_profit_confirmed    utilidad bruta contando sólo líneas con costo
pending_cost_updates      true si existen ProductCost o overrides creados después de la última recalculación del periodo
```

Ninguna venta MUST ocultarse del reporte por falta de costo.

#### Scenario: Cobertura parcial

- **WHEN** el periodo tiene ventas netas de `100000`, de las cuales `60000` con costo
- **THEN** `cost_data_coverage` es `60`, `sales_without_cost` es `40000`, y `gross_profit_confirmed` sólo considera esos `60000`

#### Scenario: Aviso de datos sin aplicar

- **WHEN** se capturan costos nuevos y se consulta el reporte sin ejecutar la recalculación
- **THEN** `pending_cost_updates` es `true`, señalando que el reporte no refleja los costos recién capturados

#### Scenario: Las ventas sin costo siguen contando como ventas

- **WHEN** una categoría tiene todas sus líneas sin costo
- **THEN** sus `net_sales` y `units_sold` aparecen completos en el reporte, con la utilidad marcada como incompleta

### Requirement: Rentabilidad por producto y SKU

El sistema SHALL exponer `GET /reports/shopify/product-profitability?start_date&end_date`, con las mismas métricas por producto: `sku`, `shopify_product_id`, `shopify_variant_id`, `title`, `category_name`, unidades, órdenes, ventas brutas, descuentos, ventas netas, COGS, utilidad bruta, margen y bandera de costo faltante.

MUST aceptar el filtro `category_name`, para bajar al detalle de una categoría del reporte anterior.

MUST aceptar `sort_by` con las mismas opciones y `page`/`limit` para paginación.

#### Scenario: Detalle de una categoría

- **WHEN** se pide `GET /reports/shopify/product-profitability?start_date=2026-07-01&end_date=2026-07-31&category_name=Sellado%20Pok%C3%A9mon`
- **THEN** la respuesta contiene sólo los productos de esa categoría, con sus métricas individuales

#### Scenario: Suma coherente con el reporte por categoría

- **WHEN** se suman las `net_sales` y las `gross_profit` de todos los productos de una categoría
- **THEN** coinciden exactamente con los valores de esa categoría en el reporte por categoría del mismo periodo

#### Scenario: Paginación

- **WHEN** se pide `page=2&limit=20` sobre un periodo con 45 productos
- **THEN** la respuesta devuelve los productos 21 a 40 con los metadatos de paginación estándar del proyecto

### Requirement: Rentabilidad por canal y pasarela

El sistema SHALL exponer `GET /reports/shopify/channel-profitability?start_date&end_date`, que agrupa por `channel` y, dentro de cada canal, por pasarela de pago.

Cada renglón SHALL incluir ventas brutas, descuentos, comisiones, costo de mercancía, envío absorbido, impuestos relacionados y utilidad neta del canal.

Cuando un dato no está disponible —comisiones no persistidas por la sincronización, por ejemplo— el campo MUST ser `null`, no `0`.

#### Scenario: Un solo canal

- **WHEN** todas las ventas del periodo son de Shopify
- **THEN** la respuesta contiene un renglón `SHOPIFY` con sus métricas, desglosado por pasarela

#### Scenario: Comisiones no disponibles

- **WHEN** la sincronización no persiste comisiones por transacción para el periodo
- **THEN** el campo de comisiones es `null` con una nota de dato no disponible, y la utilidad del canal se calcula sin restarlas, declarándolo

#### Scenario: Ingresos manuales fuera de Shopify

- **WHEN** el periodo incluye ingresos con `channel` nulo
- **THEN** aparecen agrupados en un renglón `Sin canal`, sin mezclarse con los de Shopify

### Requirement: Agregación en base de datos, no en memoria

Los reportes de rentabilidad SHALL calcularse con agregaciones SQL sobre las filas de `ShopifyLineItem`. El sistema MUST NOT cargar las líneas de un periodo en memoria para agruparlas en aplicación, ni leer `ShopifyOrder.line_items` para producir un reporte.

Los reportes MUST recalcularse en cada petición, sin caché ni snapshot, coherente con la capacidad `financial-reports`.

#### Scenario: Periodo con muchas líneas

- **WHEN** se pide el reporte por categoría de un periodo con 20 000 líneas
- **THEN** la respuesta se produce con un número acotado de consultas de agregación, sin materializar las 20 000 filas en el proceso

#### Scenario: El JSON no se usa para reportar

- **WHEN** se ejecuta cualquier endpoint de rentabilidad
- **THEN** ninguna consulta lee la columna `ShopifyOrder.line_items`

### Requirement: Reportes bajo permiso y alcance

Todos los endpoints bajo `/reports/shopify` SHALL exigir JWT válido y el permiso `report:read`.

Bajo alcance `OWN`, los reportes MUST considerar únicamente las órdenes de las conexiones de Shopify del usuario autenticado.

#### Scenario: Petición sin permiso

- **WHEN** un usuario con JWT válido y sin `report:read` pide `GET /reports/shopify/category-profitability`
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Alcance propio

- **WHEN** un usuario con alcance `OWN` pide el reporte y existen órdenes de conexiones de otro usuario en el mismo periodo
- **THEN** las cifras devueltas consideran únicamente sus propias órdenes
