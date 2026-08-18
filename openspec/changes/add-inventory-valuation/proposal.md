## Why

Hoy el negocio no puede saber cuánto dinero tiene parado en mercancía: nada en el esquema guarda cuántas piezas hay en existencia. `GET /reports/inventory-cost` valúa lo *vendido* al costo vigente, no lo que queda en el anaquel, y el único lugar donde vive el stock real es Shopify. Sin ese dato falta la mitad del panorama financiero —el inventario suele ser el activo más grande de una tienda— y tampoco hay forma de contrastar el COGS que el sistema calcula venta por venta contra la diferencia de inventarios, que es el contraste que usa cualquier contador.

## What Changes

- Nueva captura de existencias desde Shopify: se consulta `productVariants → inventoryItem → inventoryLevels` con la Admin GraphQL API y se guarda una **foto fechada** (snapshot) por conexión, con el detalle por variante y por sucursal.
- Nuevos modelos `InventorySnapshot` e `InventorySnapshotItem`. Se guardan fotos históricas, no un "stock actual" que se sobrescribe: el valor del inventario es una cifra de balance a una fecha, y sobrescribirla hace imposible responder cuánto valía al cierre de un mes ya pasado.
- Nuevo endpoint `POST /inventory/snapshots` para tomar la foto a demanda, y un cron diario que la toma por cada dueño con conexión activa, con la misma convención por dueño que los otros jobs.
- Nuevos endpoints de lectura: `GET /inventory/snapshots` (histórico con sus totales) y `GET /reports/inventory-valuation` (el avalúo: por producto, piezas × costo unitario, de mayor a menor total, con sus totales).
- El costo unitario del avalúo sigue la misma precedencia que ya usa el costeo de ventas: `ProductCost` por variante → `ProductCost` por SKU → `inventoryItem.unitCost` de Shopify; cada renglón publica de dónde salió su costo y el reporte publica qué porcentaje de las piezas quedó valuado.
- Las variantes que Shopify no rastrea (`tracked: false`) se registran con existencia **desconocida**, nunca como cero, para que el total no salga corto en silencio.
- La sincronización comprueba que la conexión tenga el scope `read_inventory` y falla con un mensaje explícito si no lo tiene, en vez de dejar que Shopify devuelva un error de autorización sin contexto.
- Nuevo permiso `inventory:read` (y su variante `OWN`) para las lecturas, e `inventory:sync` para disparar la captura.

No rompe nada existente: modelos, endpoints y permisos son todos nuevos. `GET /reports/inventory-cost` no cambia.

## Capabilities

### New Capabilities
- `inventory-valuation`: captura de existencias desde Shopify como fotos fechadas, su valuación al costo unitario vigente, y los endpoints que exponen el avalúo y su histórico.

### Modified Capabilities
<!-- Ninguna: no existe todavía spec de reports ni de la integración de Shopify en openspec/specs/, así que las reglas nuevas viven completas en el spec nuevo. -->

## Impact

- **Schema/migración**: tablas nuevas `inventory_snapshots` e `inventory_snapshot_items`, más el enum de estado del snapshot. Migración aditiva, sin backfill. Se le da uso por fin a `ProductCostSource.SHOPIFY_INVENTORY`, que existe en el enum desde julio de 2026 sin que nada lo escriba.
- **Código**: `src/shopify/` (servicio nuevo de sincronización de inventario y la consulta GraphQL), `src/inventory/` (módulo nuevo: servicio de valuación, controlador, DTOs, entidades), `src/reports/reports.controller.ts` (el endpoint del avalúo), `src/jobs/scheduled-jobs.service.ts` (el cron diario), `src/permissions/permission-catalog.ts`.
- **API/contrato**: cuatro endpoints nuevos, documentados solos vía el plugin de `@nestjs/swagger`.
- **Shopify**: usa el scope `read_inventory`, que ya está en el valor por omisión de `SHOPIFY_SCOPES`. Las conexiones instaladas antes de que ese scope estuviera en la lista necesitan reinstalarse; el sistema lo detecta y lo dice.
- **Límites asumidos**: el avalúo es "costo actual × piezas", no costeo PEPS ni promedio ponderado — `unitCost` de Shopify es un número que alguien captura a mano, así que un alza de costo revalúa mercancía comprada barata. Sirve para saber cuánto dinero está parado; no es un costo de ventas fiscal.
- **Frontend** (`paldex-app`): consume los endpoints nuevos vía el contrato de `/api-docs/json`.
