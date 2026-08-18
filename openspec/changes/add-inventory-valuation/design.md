## Context

La API ya sincroniza pedidos, artículos y transacciones de Shopify (`src/shopify/`), y ya sabe costear una venta: `resolveLineItemCost` (`src/shopify/cost-resolver.ts`) elige entre el costo congelado en el pedido y los renglones de `ProductCost` por variante o por SKU. Lo que nunca se ha traído son los **niveles de inventario**: `ShopifyLineItem` guarda `unit_cost` porque el backfill lo pide dentro de `variant { inventoryItem { unitCost } }`, pero nadie ha consultado `inventoryLevels`.

El resultado es que `GET /reports/inventory-cost` —el reporte más reciente— sólo puede valuar lo vendido, y lo dice en su propia documentación. El activo más grande de la tienda no aparece en ninguna parte.

Restricciones que condicionan el diseño:

- El scope `read_inventory` ya es el valor por omisión de `SHOPIFY_SCOPES`, pero lo que vale es el scope que Shopify concedió y quedó guardado en `ShopifyConnection.scope` al instalar.
- Todo el dinero va en `Decimal(14,2)` y se proyecta a número con `src/common/money.ts`.
- Los reportes se fechan en la zona del negocio (`src/common/timezone.ts`), nunca en UTC.
- Los crons corren por dueño con `scope: 'OWN'`, nunca globalmente (`src/jobs/scheduled-jobs.service.ts`).
- Autorización deny-by-default: cada handler necesita su `@RequirePermissions` y su entrada en `permission-catalog.ts`.
- El enum `ProductCostSource.SHOPIFY_INVENTORY` existe desde la migración de julio de 2026 y nada lo escribe.

## Goals / Non-Goals

**Goals:**

- Saber cuánto dinero hay parado en mercancía, por producto y en total.
- Que ese número sea auditable: de dónde salió cada costo, y qué parte de las piezas quedó sin valuar.
- Conservar el avalúo de fechas pasadas, para poder cerrar un mes y para contrastar el COGS por diferencia de inventarios contra el que el sistema calcula venta por venta.
- No divergir del costeo de ventas que ya existe: mismo orden de precedencia, mismos tipos de dinero, misma convención de zona horaria.

**Non-Goals:**

- **No es costeo de inventario real.** No hay capas PEPS ni promedio ponderado; `unitCost` de Shopify es un número que alguien teclea. Un alza de costo revalúa hacia arriba mercancía comprada barata.
- **No es un valor en vivo.** El avalúo se lee de una foto guardada, no consulta Shopify en cada petición.
- **No se escriben existencias a Shopify.** La sincronización es de una sola dirección.
- **No se calcula todavía el COGS por diferencia de inventarios.** Este cambio deja los datos para hacerlo; el reporte que lo compare contra `GET /reports/monthly` es un cambio aparte.
- No se toca `GET /reports/inventory-cost`.

## Decisions

### Fotos fechadas, no una tabla de stock actual

Dos modelos: `InventorySnapshot` (la foto: conexión, dueño, `taken_at`, estado, totales) e `InventorySnapshotItem` (un renglón por variante y sucursal).

Alternativa descartada: una sola tabla `InventoryLevel` que se sobrescribe en cada refresh. Es menos código, pero el valor del inventario es una cifra de balance **a una fecha**: al sobrescribirla se pierde para siempre la respuesta a "¿cuánto valía el 31 de julio?", que es justo lo que pide un cierre mensual y lo que hace posible el COGS por diferencia. Recuperar historia después obliga a un rediseño; guardarla desde el principio cuesta una tabla más.

El costo se **congela en el renglón** al capturar (`unit_cost`, `total_cost`, `cost_source`), no se recalcula al leer. Si se recalculara, el avalúo de julio cambiaría cada vez que alguien corrige un `ProductCost` hoy — el mismo defecto que el reporte de ventas por empleado documenta como consecuencia asumida, y que aquí sí se puede evitar porque la foto es un hecho fechado.

### Consulta paginada, no bulk operation

`productVariants(first: 250, after: $cursor)` con `inventoryItem { id tracked unitCost { amount } inventoryLevels(first: 10) { ... quantities(names: ["on_hand"]) } }`, paginando con `pageInfo`.

Alternativa descartada: una Bulk Operation como la del backfill. Las bulk ops existen para decenas de miles de registros y cuestan minutos de polling más descarga y parseo de JSONL; un catálogo de cientos de variantes cabe en unas pocas páginas de segundos. `ShopifyGraphQLService.graphql()` ya existe y ya maneja el token cifrado y los errores de GraphQL. Si algún día una tienda no termina en un tiempo razonable, la misma consulta se puede mover a bulk sin cambiar el modelo de datos.

`productVariants` va en la raíz a propósito: `products → variants → inventoryItem.inventoryLevels` serían tres niveles de anidamiento, que es lo que impide reutilizar esta consulta en una bulk operation más adelante.

### Sin desglose por sucursal

`location { name }` exige el scope `read_locations`, que la app no pide —y pedirlo obligaría a
reinstalar cada conexión ya instalada—. Shopify no degrada ese campo: rechaza la consulta entera
con `ACCESS_DENIED`, así que pedirlo dejaba la captura sin existencias en absoluto. Se suman las
sucursales en un renglón por variante. El total, que es lo que se valúa, sale idéntico; lo que se
pierde es poder ver cuánto hay en la tienda y cuánto en la bodega.

La columna `location_name` se conserva nula en el esquema: el día que se pida `read_locations`, el
desglose vuelve sin migración.

### `on_hand`, no `available`

`available` descuenta lo comprometido por pedidos aún sin surtir. Esa mercancía sigue siendo del negocio hasta que sale por la puerta, así que valuar con `available` subvalúa el inventario justo en la temporada de más pedidos abiertos, que es cuando más importa el número.

### Precedencia de costo espejo del costeo de ventas

`ProductCost` por variante → `ProductCost` por SKU → `inventoryItem.unitCost` de Shopify. Es el mismo orden de `resolveLineItemCost` salvo el costo congelado, que no aplica: mercancía sin vender no tiene venta donde congelarse. No se reutiliza esa función tal cual porque su primer parámetro es precisamente el costo congelado; se escribe la resolución en el servicio de valuación y se documenta el paralelo, para que cuando alguien cambie una, encuentre la otra.

De `ProductCost` se toma el vigente a `taken_at`, ignorando `effective_from` futuros — igual que hace el reporte `inventory-cost`.

Se aprovecha la captura para sembrar `ProductCost` con `source: SHOPIFY_INVENTORY` cuando Shopify trae `unitCost` y el dueño no tiene renglón para esa variante. Le da uso al valor del enum que lleva meses muerto y hace que el catálogo de costos se llene solo.

### Dos valuaciones del mismo inventario

La misma foto se valúa al costo (lo que salió del bolsillo) y al precio de lista (lo que entraría si se
vendiera todo sin descuento). Son las dos preguntas que un dueño hace del mismo montón de mercancía, y
la diferencia entre ambas es la ganancia bruta que queda por cobrar.

`retail_value` es un **techo**, no un pronóstico: nadie vende su inventario completo, ni a precio de
lista. Se publica junto a `products_priced` para que se note cuando alguna pieza no tiene precio y el
número va corto — la misma disciplina que `cost_coverage` aplica al costo.

El precio viene de `ProductVariant.price` (scope `read_products`, ya concedido) y **sólo** de ahí. No
se cruza con `ProductCost`, que responde la otra mitad del par, ni con el precio al que se vendió
antes, que es histórico y ya trae descuentos aplicados.

### Existencia desconocida ≠ cero

`quantity_on_hand` es nullable. `tracked: false` guarda `null`, no `0`. Un cero dice "no tengo nada" y resta del avalúo; un nulo dice "no sé", y el snapshot publica cuántas variantes están así. Confundirlos hace que el total salga corto sin que nadie se entere, que es el modo de fallo que este proyecto evita en todos sus reportes.

### La foto se publica al terminar, no mientras se llena

`InventorySnapshot.status` con `PENDING` → `COMPLETE` / `FAILED`. El avalúo sólo mira fotos `COMPLETE`. Una captura que se cae a la mitad de la paginación deja una foto `FAILED` con sus renglones parciales —útiles para depurar— pero jamás valuable. Sin esto, un timeout a media captura produciría un avalúo que parece bueno y está a la mitad.

### Cron diario, no webhook

`INVENTORY_LEVELS_UPDATE` dispara en cada venta y cada recepción: reescribiría lo mismo cientos de veces al día para un dato que sólo se consulta como saldo diario. Además su payload identifica por `inventory_item_id`, que hoy el esquema no mapea a nada — razón por la que el renglón guarda `shopify_inventory_item_id`, que deja esa puerta abierta sin pagarla ahora.

El cron va a las 6:15, después de nómina (6:00) y recurrentes (6:05), con `forEachOwner` y `scope: 'OWN'` como los otros tres.

### Módulo propio, reporte en `/reports`

La captura y el histórico viven en `src/inventory/` (`POST /inventory/snapshots`, `GET /inventory/snapshots`); el avalúo se expone como `GET /reports/inventory-valuation` junto a los demás reportes, porque es donde el frontend ya busca reportes y porque hereda `@RequirePermissions('report:read')` de la clase. La consulta a Shopify vive en `src/shopify/shopify-inventory-sync.service.ts`, junto al resto de la integración.

## Risks / Trade-offs

- **El avalúo no es un costo fiscal** → Se documenta en el endpoint, en la entidad y en `CLAUDE.md`: es "costo actual × piezas", sirve para saber cuánto dinero está parado, no para declarar. Quien necesite PEPS necesita capas de costo, que es otro proyecto.
- **Conexiones instaladas sin `read_inventory`** → Se comprueba `ShopifyConnection.scope` antes de llamar a Shopify y se falla diciendo que hay que reinstalar. Sin esa comprobación el fallo llega como un error de autorización de GraphQL sin contexto, a las 6:15 de la mañana, dentro de un cron.
- **Una tienda con miles de variantes tarda** → La paginación tiene tope de páginas y la foto queda `FAILED` si lo excede, en vez de colgar el cron. La consulta está escrita para poder migrarse a bulk operation sin tocar el modelo.
- **Crecimiento de la tabla de renglones** → Una foto diaria × variantes × sucursales. Para una tienda chica son miles de filas al año, irrelevante; si creciera, la poda (conservar la última de cada mes) es un cambio posterior que no rompe nada porque el avalúo ya elige la foto por fecha.
- **`unitCost` de Shopify puede venir vacío** → Cae en costo nulo y baja la cobertura, que es exactamente lo que el reporte publica para que se note. No se inventa un costo.
- **Dos fuentes de "costo de inventario" en `/reports`** (`inventory-cost` valúa lo vendido, `inventory-valuation` lo que queda) → Los nombres y las descripciones de Swagger lo dicen explícitamente, y cada uno remite al otro.

## Migration Plan

1. Migración aditiva con Prisma dentro del contenedor (`npx prisma migrate dev --create-only`): dos tablas nuevas y un enum de estado. Sin backfill: sin fotos, el avalúo responde que no hay ninguna y dice cómo tomar la primera.
2. Alta de `inventory:read`, `inventory:sync` y sus variantes `OWN` en `permission-catalog.ts`; la sincronización de permisos corre sola en `onModuleInit`.
3. Asignar los permisos nuevos a los roles que corresponda (`PUT /roles/:id/permissions`) — sin eso, deny-by-default responde `403` sin pista.
4. Primera foto a mano con `POST /inventory/snapshots` para verificar el scope y ver la cobertura de costos antes de confiar en el cron.
5. Rollback: los endpoints y el cron son nuevos y aislados; deshabilitar es dejar de llamarlos (o `SCHEDULED_JOBS_ENABLED=false` para el cron). Las tablas nuevas no las lee nada más.

## Open Questions

- ~~¿El avalúo debe separarse por sucursal?~~ **Resuelto durante la implementación**: no se puede sin el scope `read_locations`, y añadirlo obliga a reinstalar la conexión. Se suman las sucursales. La columna queda en el esquema para poder recuperarlo sin migración.
- ¿Cuánto histórico conservar? Por ahora todo. La poda se decide cuando el volumen lo pida.
- El COGS por diferencia de inventarios (inicial + compras − final) contrastado contra `GET /reports/monthly` queda fuera de este cambio, pero es la razón principal para guardar historia.
