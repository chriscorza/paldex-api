## ADDED Requirements

### Requirement: Catálogo de costos por producto o SKU

El sistema SHALL exponer CRUD completo sobre `/product-costs`, protegido por los permisos `product_cost:<action>`.

Un `ProductCost` SHALL tener `unit_cost`, `effective_from`, `source` (`MANUAL`, `SHOPIFY_INVENTORY`, `IMPORTED`), `notes` opcional, y **al menos uno** de `shopify_variant_id` o `sku`.

Una petición sin ninguno de los dos identificadores MUST responder `400 Bad Request`.

#### Scenario: Costo por variante

- **WHEN** se envía `POST /product-costs` con `{ "shopify_variant_id": "4412", "unit_cost": 900, "effective_from": "2026-07-01", "source": "MANUAL" }`
- **THEN** el sistema responde `201 Created`

#### Scenario: Costo por SKU

- **WHEN** se envía `POST /product-costs` con `{ "sku": "ETB-SV8", "unit_cost": 900, "effective_from": "2026-07-01", "source": "MANUAL" }`
- **THEN** el sistema responde `201 Created`

#### Scenario: Sin identificador de producto

- **WHEN** se envía `POST /product-costs` sin `shopify_variant_id` ni `sku`
- **THEN** el sistema responde `400 Bad Request` indicando que hace falta al menos uno, y no crea nada

#### Scenario: Costo no positivo

- **WHEN** se envía `"unit_cost": 0` o un valor negativo
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Histórico de costo por fecha de vigencia

Un mismo producto SHALL poder tener varios `ProductCost` con distintas `effective_from`.

El costo aplicable a una orden SHALL ser el registro con la `effective_from` más reciente que sea **anterior o igual** a la fecha de la orden. Si no existe ninguno anterior a esa fecha, el producto MUST tratarse como sin costo para esa orden — el sistema MUST NOT usar un costo con vigencia futura.

Crear un `ProductCost` nuevo MUST NOT modificar por sí solo la utilidad de órdenes ya calculadas: eso ocurre en la recalculación explícita.

#### Scenario: Dos vigencias, orden intermedia

- **WHEN** un producto tiene costo `800` desde el 1 de junio y `900` desde el 1 de agosto, y se resuelve el costo de una orden del 15 de julio
- **THEN** el costo aplicado es `800`

#### Scenario: Sólo hay costo con vigencia futura

- **WHEN** un producto tiene costo `900` desde el 1 de agosto y se resuelve el costo de una orden del 15 de julio
- **THEN** el producto se trata como sin costo para esa orden, y la línea queda con `unit_cost: null`

#### Scenario: Registrar un costo nuevo no reescribe el histórico

- **WHEN** se crea un costo con vigencia del 1 de junio para un producto vendido en julio, y no se ejecuta la recalculación
- **THEN** la línea de julio conserva su costo anterior, y el reporte indica que hay costos nuevos sin aplicar

### Requirement: Precedencia de resolución de costo por línea

El costo de una línea SHALL resolverse siguiendo esta precedencia, deteniéndose en el primer eslabón que produzca un valor:

1. el costo ya congelado en la línea al momento de sincronizar, si existe;
2. `ProductCost` vigente por `shopify_variant_id`;
3. `ProductCost` vigente por `sku`;
4. sin costo — `unit_cost = null`.

La resolución SHALL implementarse como una función pura, sin acceso a base de datos.

Un costo ausente MUST NOT tratarse como `0` en ningún eslabón.

#### Scenario: La variante gana sobre el SKU

- **WHEN** existen un `ProductCost` de `900` por `shopify_variant_id` y otro de `850` por el `sku` de la misma línea, ambos vigentes
- **THEN** la línea usa `900`

#### Scenario: Caída al SKU

- **WHEN** no hay costo por variante y sí un costo vigente de `850` por `sku`
- **THEN** la línea usa `850`

#### Scenario: Sin costo en ningún eslabón

- **WHEN** no hay costo congelado, ni por variante, ni por SKU
- **THEN** la línea queda con `unit_cost: null` y cuenta como venta sin costo, nunca con costo `0`

### Requirement: Carga masiva de costos

El sistema SHALL exponer `POST /product-costs/bulk`, que recibe un arreglo de entradas con `sku` o `shopify_variant_id`, `unit_cost` y `effective_from` opcional.

La operación SHALL ser **todo o nada**: si alguna entrada es inválida, el sistema MUST responder `400 Bad Request` identificando el índice y el motivo de cada entrada inválida, y MUST NOT crear ninguna.

La respuesta de una carga válida MUST informar cuántos costos se crearon y cuántos se actualizaron.

#### Scenario: Carga válida de 40 costos

- **WHEN** se envía `POST /product-costs/bulk` con 40 entradas válidas
- **THEN** el sistema responde `201 Created` informando 40 creados

#### Scenario: Una entrada inválida invalida el lote

- **WHEN** se envía un lote de 40 entradas donde la número 12 tiene `unit_cost: -5`
- **THEN** el sistema responde `400 Bad Request` señalando el índice 12, y no crea ninguno de los 40

#### Scenario: Lote vacío

- **WHEN** se envía `POST /product-costs/bulk` con un arreglo vacío
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Lista de trabajo de costos faltantes

El sistema SHALL exponer `GET /product-costs/missing?start_date&end_date`, que lista los productos vendidos en el periodo sin costo resoluble.

La respuesta SHALL incluir por producto: `sku`, `shopify_variant_id`, `title`, unidades vendidas, ventas netas acumuladas y número de órdenes, ordenada por **ventas netas descendente** por defecto.

Este orden es deliberado: capturar primero el costo de lo que más se vendió es lo que sube más rápido la confiabilidad del reporte.

#### Scenario: Lista ordenada por impacto

- **WHEN** se pide `GET /product-costs/missing?start_date=2026-07-01&end_date=2026-07-31`
- **THEN** la respuesta lista los productos sin costo del periodo, con el de mayores ventas netas primero, y el total de ventas sin costear

#### Scenario: Cobertura completa

- **WHEN** todos los productos vendidos en el periodo tienen costo
- **THEN** la respuesta es una lista vacía con `total_sales_without_cost: 0`

### Requirement: Recalculación idempotente de costo y utilidad

El sistema SHALL exponer `POST /shopify/recalculate-costs?start_date&end_date`, que para las líneas del periodo:

1. reresuelve el costo según la precedencia vigente;
2. recalcula `total_cost`, `gross_profit` y `profit_margin` de cada línea;
3. recalcula `cost_total`, `profit_total` y `has_missing_cost_data` de cada orden afectada;
4. propaga `cogs_total` y `profit_gross` a los `Income` ligados.

La operación SHALL ser idempotente: ejecutarla dos veces con los mismos datos produce el mismo resultado.

La respuesta MUST informar cuántas líneas, órdenes e ingresos se actualizaron.

#### Scenario: Capturar un costo tarde y recalcular

- **WHEN** se captura el costo de un producto vendido en julio y se ejecuta la recalculación de julio
- **THEN** las líneas de ese producto obtienen su costo y utilidad, la orden actualiza sus totales, y el ingreso asociado actualiza `cogs_total` y `profit_gross`

#### Scenario: Recalculación repetida

- **WHEN** se ejecuta la recalculación dos veces con el mismo rango y sin cambios de costo
- **THEN** los valores resultantes son idénticos y la segunda ejecución informa cero cambios efectivos

#### Scenario: La recalculación no inventa costos

- **WHEN** se ejecuta la recalculación sobre un periodo con productos que siguen sin costo
- **THEN** esas líneas conservan `unit_cost: null`, y `has_missing_cost_data` de sus órdenes sigue en `true`

#### Scenario: El estado mensual mejora sin cambiar de fórmula

- **WHEN** después de recalcular se pide `GET /reports/monthly` del mismo periodo
- **THEN** `cogs` y `cost_data_coverage` reflejan la cobertura nueva, con las mismas fórmulas de MVP 1

### Requirement: Los costos son datos del usuario

Los `ProductCost` y los `ProductCategoryOverride` SHALL respetar el alcance por propietario del proyecto: bajo alcance `OWN`, un usuario MUST ver y resolver únicamente sus propios costos y overrides.

#### Scenario: Alcance propio

- **WHEN** un usuario con `product_cost:read` en alcance `OWN` pide `GET /product-costs` y existen costos de otro usuario
- **THEN** la respuesta contiene únicamente los suyos

#### Scenario: Resolución bajo alcance propio

- **WHEN** se resuelve el costo de una línea de una orden de un usuario y existe un `ProductCost` de otro usuario para el mismo SKU
- **THEN** ese costo ajeno no se aplica
