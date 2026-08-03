## Why

Parte de los ingresos que este sistema debe registrar no se teclean a mano: nacen en una tienda Shopify. Hoy no hay ningún puente entre ambos — cada venta habría que darla de alta manualmente en `/incomes`, lo cual es tedioso y garantiza que los datos se desincronicen. Pero el objetivo no es sólo registrar que entró dinero: lo que realmente importa es saber **cuánto se ganó**, y eso exige combinar lo que el cliente pagó con el costo de lo que se vendió, el descuento aplicado y el IVA cobrado — ninguno de los cuales vive junto al otro en los datos que Shopify expone.

## What Changes

- **Conexión de tienda vía OAuth externo** (no embebido — paldex vive fuera del admin de Shopify): nuevo modelo `ShopifyConnection` con el token de acceso cifrado en reposo, la cuenta de paldex a la que se destina el dinero, y su estado (`ACTIVE`, `REVOKED`, `ERROR`).
- **Sólo tiendas que operan en pesos mexicanos.** La conexión se rechaza si la moneda de la tienda no es MXN — no se resuelve conversión de divisas en este change.
- **Sincronización de dinero a nivel de transacción, no de pedido**: cada transacción exitosa (`sale`/`capture`) genera un `Income` propio, con su método de pago como dato — así un pedido pagado mitad tarjeta, mitad gift card produce dos ingresos, cada uno trazable a su transacción de origen.
- **Snapshot financiero por pedido**: nuevo modelo `ShopifyOrder`, independiente de los `Income`, con el desglose de cada línea de producto — precio, descuento ya asignado por Shopify, costo del artículo, IVA y ganancia. Es el corazón de este change: sin él, "ganancia" no es una pregunta que la API pueda responder.
- **El costo se congela en el momento de sincronizar**, porque Shopify no guarda un histórico de costo por pedido — sólo el costo *actual* del producto. Un cambio de costo posterior no reescribe pedidos ya sincronizados.
- **El costo faltante nunca se trata como cero.** Si un producto se borró del catálogo y su costo ya no es recuperable, el pedido se marca explícitamente como de ganancia incompleta — la alternativa, asumir $0 de costo, infla la ganancia de forma silenciosa.
- **El IVA se calcula con la fórmula de impuesto incluido**, porque los precios de la tienda ya lo incluyen: se descuenta del ingreso antes de calcular la ganancia, no se sabe si sumar aparte.
- **Modelo híbrido de sincronización**:
  - Carga inicial del histórico completo vía **Bulk Operations** de la GraphQL Admin API, sin gastar el presupuesto de rate limit normal.
  - **Webhooks `orders/create` y `orders/updated`** para capturar y mantener al día el desglose de cada pedido (líneas, descuento, costo, IVA).
  - **Webhook `order_transactions/create`** para las ventas nuevas — entrega en segundos.
  - **Webhook `refunds/create`** para reembolsos: reduce el `Income` original (o lo borra si el reembolso lo agota), y ajusta proporcionalmente el `ShopifyOrder` de ese pedido.
  - **Reconciliación diaria** de bajo coste como red de seguridad frente a webhooks perdidos — Shopify no garantiza entrega al 100 %.
- **Tres webhooks de cumplimiento obligatorios** (`customers/data_request`, `customers/redact`, `shop/redact`), requisito de Shopify para cualquier app con acceso a datos de pedidos.
- **Trazabilidad de origen en `Income`**: nuevos campos `source` y `external_reference` (visibles en la API), un identificador interno de transacción para idempotencia y casamiento de reembolsos, y un enlace a su `ShopifyOrder`.
- **Sin ingestión de datos personales del comprador**: sólo se importan campos financieros (monto, fecha, método de pago, producto, costo, referencia del pedido). No se guarda nombre, email ni dirección de ningún cliente de la tienda — decisión deliberada que simplifica el cumplimiento de `customers/redact` a un `200 OK` inmediato, porque no hay nada personal que borrar.

### No incluido (non-goals)

- **No se implementa nada en el frontend.** Este change es sólo la API: los endpoints que un futuro flujo de "conectar tienda" consumirá quedan definidos en el `design.md`, pero ninguna pantalla se construye aquí.
- **No se mapean gastos.** Los reembolsos afectan al `Income` y al `ShopifyOrder` existentes; no se crea ningún `Expense` a partir de Shopify en esta primera versión.
- **El envío queda fuera del total y de la ganancia.** Sólo se calcula sobre las líneas de producto.
- **No se resuelve la conversión de moneda.** Se asume MXN en ambos lados — tienda y cuenta destino — y se valida al conectar. Un usuario que necesite otra moneda queda fuera de alcance de este change.
- **No depende de que `add-user-data-scoping` esté implementado.** `ShopifyConnection` lleva su propio `user_id` desde el primer día, independiente de si `Account`/`Income`/`Expense` ya tienen propietario. Los `Income` que la sincronización crea son, mientras tanto, tan globales como cualquier otro — ni mejor ni peor que el resto del sistema hoy.
- No se publica la app en el Shopify App Store; se registra como app privada/custom-distributed en el Partner Dashboard, instalable sólo en las tiendas que un usuario de paldex conecte explícitamente.
- No se soporta reconectar una tienda a un usuario distinto del que la conectó originalmente sin desconectarla antes.
- No se construye ningún reporte ni vista agregada de rentabilidad — este change guarda el dato de ganancia por pedido; presentarlo (por producto, por periodo, etc.) es trabajo posterior.

## Capabilities

### New Capabilities
- `shopify-connection`: el ciclo de vida de conectar, listar y desconectar una tienda Shopify — la autorización OAuth, el almacenamiento seguro del token, la elección de cuenta destino y los webhooks de cumplimiento.
- `shopify-order-sync`: la traducción de transacciones y reembolsos de Shopify a `Income` de paldex — carga inicial, webhooks en tiempo real, reconciliación periódica e idempotencia.

### Modified Capabilities
- `incomes-crud`: el `Income` gana los campos `source` y `external_reference`, de sólo lectura para el cliente de la API, poblados exclusivamente por la sincronización.

## Impact

**Base de datos** — migración:
- `ShopifyConnection`: `id`, `user_id`, `shop_domain` (único), `account_id`, `access_token` (cifrado), `scope`, `status`, `installed_at`, `last_synced_at`.
- `ShopifyOrder`: `id`, `shopify_connection_id`, `external_order_id`, `order_number`, `items_total`, `shopify_order_total` (informativo, incluye envío), `discount_total`, `tax_total`, `cost_total`, `profit_total`, `has_missing_cost_data`, `line_items` (JSON con el desglose por línea), `synced_at`.
- `Income`: nuevas columnas `source?`, `external_transaction_id?`, `external_reference?`, `shopify_order_id?` (FK a `ShopifyOrder`), con `@@unique([source, external_transaction_id])` para idempotencia.

**Código nuevo**
- `src/shopify/` — módulo de conexión (OAuth, endpoints de gestión), módulo de sincronización (webhooks, mapeo, backfill, reconciliación).
- Cifrado de credenciales a nivel de aplicación (no hay gestor de secretos en el proyecto).

**Código modificado**
- `src/incomes/entities/income.entity.ts` — nuevos campos en la proyección pública.
- `src/app.module.ts` — registrar los módulos nuevos.
- `src/main.ts` — habilitar `rawBody` para verificar la firma HMAC de los webhooks de Shopify antes de que el `ValidationPipe` global los toque.

**Infraestructura**: nuevas variables de entorno (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_TOKEN_ENCRYPTION_KEY`, `SHOPIFY_SCOPES`, URL pública de callback). Requiere una app registrada en el Partner Dashboard de Shopify.

**Dependencias**: usa `@CurrentUser()` y el sistema de permisos de `add-roles-permissions` (ya implementado). No depende de `add-user-data-scoping`.

**Contrato de API**: `GET /incomes` y `GET /incomes/:id` devuelven dos campos nuevos, opcionales, `null` para todo income creado manualmente. No rompe a ningún consumidor existente.
