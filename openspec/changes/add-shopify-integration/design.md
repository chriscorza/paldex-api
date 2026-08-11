## Context

Este change conecta paldex a Shopify. Es distinto en naturaleza a todo lo implementado hasta ahora: los changes anteriores modelaban datos que el usuario introduce; éste modela datos que **llegan de un sistema externo, de forma asíncrona, con garantías de entrega imperfectas**, y que hay que traducir a un dominio financiero que no fue diseñado pensando en pedidos de comercio electrónico.

Estado de la API de Shopify verificado en julio de 2026, en el momento de escribir esto:

- La superficie vigente es la **GraphQL Admin API** (versión `2026-07`). La REST Admin API es legacy desde octubre de 2024 y Shopify retira endpoints por oleadas — no se construye nada nuevo sobre REST. [Fuente: shopify.dev/docs/api/release-notes]
- El coste de las consultas GraphQL se mide por **complejidad** (cost-based throttling), no por número de peticiones; cada app-tienda tiene su propio balance que se recarga solo. [Fuente: shopify.dev/docs/api/usage/limits]
- Para volumen histórico, Shopify recomienda **Bulk Operations** (`bulkOperationRunQuery`): corre la consulta de forma asíncrona en su infraestructura y entrega un JSONL, sin consumir el presupuesto de rate limit normal. [Fuente: shopify.dev/docs/api/usage/bulk-operations/queries]
- Existe un webhook a **nivel de transacción individual**: `order_transactions/create` (`ORDER_TRANSACTIONS_CREATE` en GraphQL), que "ocurre cuando se crea una transacción de pedido o cuando su estado se actualiza". Es más granular que `orders/paid`, que sólo confirma que el pedido en conjunto quedó pagado y no expone el desglose por transacción. [Fuente: shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic]
- `refunds/create` "se activa siempre que se crea un reembolso sin errores sobre un pedido". Cada reembolso trae su propio array de transacciones de tipo `refund`, cada una con un `parent_id` que apunta a la transacción original que reembolsa.
- Shopify exige tres **webhooks de cumplimiento** para cualquier app con acceso a datos de pedidos: solicitud de datos de cliente, borrado de datos de cliente, borrado de tienda. Si el HMAC no verifica o no se responde `200`, se marca como fallo de cumplimiento.

Este es el primer change del proyecto que habla con un sistema externo. Trae dos clases de riesgo que no existían antes: **credenciales de terceros que hay que guardar de forma segura**, y **eventos que pueden perderse, duplicarse o llegar fuera de orden**, algo que ninguna API interna de paldex tiene que afrontar.

**Lo que cambió el alcance de este change**: el objetivo dejó de ser "registrar el dinero que entra" para ser "saber cuánto se gana", y eso exige tres piezas de datos que Shopify no guarda juntas:

- **El costo no vive en el pedido.** `LineItem` no tiene campo de costo — el costo vive únicamente en `InventoryItem.unitCost`, que es el costo **actual** del producto, no un histórico por venta. Consultarlo tiempo después de la venta da el costo de hoy, no el de entonces. [Fuente: shopify.dev/docs/api/admin-graphql/latest/objects/InventoryItem]
- **El descuento ya viene resuelto por línea.** `LineItem.discountAllocations` da el monto final de descuento asignado a cada línea, sin importar si el descuento se configuró sobre todo el pedido o sobre un producto específico — Shopify hace esa resolución antes de que los datos lleguen aquí. `DiscountApplication` describe la intención de la regla; `DiscountAllocation` es el monto real ya repartido, y es el que hay que usar. [Fuente: shopify.dev/docs/api/admin-graphql/latest/objects/discountallocation]
- **El IVA es una porción del precio, no un extra.** Con precios de impuesto incluido (`taxesIncluded`), el monto cobrado no cambia al calcular el impuesto — el impuesto se calcula como `(tasa × precio) / (1 + tasa)` y se declara aparte, pero ya estaba dentro del precio. Es el modelo que corresponde a una tienda mexicana con IVA incluido. [Fuente: help.shopify.com/en/manual/taxes/include-exclude-taxes]

Ninguno de los tres — costo, descuento, IVA — llega en el payload del webhook de transacción (`order_transactions/create`), que sólo describe el movimiento de dinero. Para obtenerlos hace falta consultar el **pedido** con sus líneas, sus variantes y el costo de inventario de cada una — una pieza de sincronización separada de la que crea los `Income`.

## Goals / Non-Goals

**Goals:**

- Conectar una tienda Shopify a un usuario y a una cuenta de paldex, vía OAuth externo, restringido a tiendas en pesos mexicanos.
- Que cada venta —a nivel de transacción, no de pedido— aparezca como `Income` sin intervención manual.
- Que cada pedido tenga un desglose fiable de total, descuento, costo, IVA y **ganancia** — el dato que motiva todo este change.
- Que un costo que no se puede obtener se note, en vez de tratarse silenciosamente como cero.
- Que un reembolso se refleje automáticamente sobre el income y sobre la ganancia del pedido que corresponde.
- Que ningún evento se pierda de forma silenciosa ni se duplique.
- Cumplir los requisitos de cumplimiento de Shopify sin necesidad de ingerir datos personales de terceros.

**Non-Goals:**

- Frontend. Ninguna pantalla se construye en este change.
- Mapear gastos, comisiones de Shopify Payments, ni impuestos de la tienda al catálogo de `Tax` de paldex.
- Envío: ni su costo ni su ingreso entran en el total ni en la ganancia.
- Conversión de moneda: se asume y se valida MXN en ambos extremos.
- Compartir una conexión entre varios usuarios de paldex.
- Publicar la app en el Shopify App Store.
- Reportes o vistas agregadas de rentabilidad — este change produce el dato, no su presentación.

## Decisions

### 1. Sincronización híbrida: backfill en bloque + webhooks + reconciliación

Ninguna de las tres vías por sí sola es suficiente:

- **Sólo webhooks** deja sin cubrir todo lo anterior a la conexión, y Shopify no garantiza entrega al 100 % — un endpoint caído unos minutos pierde eventos para siempre si no hay red de seguridad.
- **Sólo polling** desperdicia presupuesto de API constantemente y contradice la expectativa de "en cuanto se vende, aparece", que es justo lo que se pidió.
- **Sólo backfill** no sirve para nada después del primer día.

Por eso: **Bulk Operation** una vez, al conectar, para el histórico; **webhooks** (`order_transactions/create`, `refunds/create`) para lo que ocurre después; **reconciliación diaria**, de bajo coste, como red de seguridad. Es la combinación que la documentación y las guías de la propia comunidad de Shopify recomiendan de forma consistente para este tipo de integración.

### 2. Granularidad: un Income por transacción, no por pedido ni por payout

Se consideraron tres niveles:

- **Por pedido**: simple, pero no distingue métodos de pago. Un pedido pagado mitad tarjeta, mitad gift card se convertiría en un único income que mezcla dos gateways distintos — información que se pidió explícitamente conservar.
- **Por payout** (liquidación bancaria de Shopify Payments): el más fiel al dinero que realmente entra al banco, neto de comisiones. Pero exige el Payouts API, que sólo existe si la tienda usa Shopify Payments — quedaría sin soporte cualquier tienda que use PayPal, Stripe u otro gateway externo como método principal. Pierde además la trazabilidad pedido a pedido, que es la que permite casar un reembolso con su venta.
- **Por transacción** (la elegida): cada `sale`/`capture` exitoso es un evento de dinero entrando, con su propio gateway y su propio momento. Resuelve el caso de pago dividido de forma natural — dos transacciones, dos incomes — y es exactamente el nivel al que Shopify expone un webhook dedicado (`order_transactions/create`), así que no hace falta reconstruirlo a partir de eventos de pedido.

*Coste asumido:* un pedido con varios métodos de pago deja de verse como "una venta" en `/incomes` — se ve como varias filas relacionadas por `external_reference`, no por un único registro. Es el trade-off que la decisión explícita de capturar el desglose por método de pago implica.

### 2.1. `ShopifyOrder`, un registro aparte para la economía del pedido

El costo, el descuento, el IVA y la ganancia son un concepto **por pedido** (o por línea de producto dentro de él) — no tiene sentido repartir "cuánto costaron los productos vendidos" entre las dos transacciones de un pago dividido. Forzar esos campos dentro de `Income` mezclaría dos dimensiones de dato distintas: cuánto dinero entró (por transacción) y cuánto se ganó (por pedido).

Se introduce `ShopifyOrder`: un registro por pedido de Shopify, con el desglose por línea (precio, descuento, costo, IVA, ganancia) y los totales agregados. Cada `Income` que ese pedido genera queda enlazado a su `ShopifyOrder` mediante FK, pero son conceptualmente independientes — se puede tener uno sin el otro:

- Un `ShopifyOrder` sin `Income` todavía: el pedido se colocó pero no se ha pagado.
- Un `Income` sin `ShopifyOrder` momentáneamente: la transacción llegó por webhook antes que los datos completos del pedido — no hay motivo para retrasar el registro del dinero recibido esperando a que el desglose de costo esté listo; el enlace se completa en cuanto el pedido se sincroniza.

*Alternativa descartada:* añadir `cost`/`profit`/`discount` como columnas de `Income`. Se descarta porque un pedido con pago dividido tendría que repartir esos valores de forma arbitraria entre sus transacciones, y porque mezclaría el ledger de caja (income = dinero que entró, hecho) con una estimación analítica (ganancia = cálculo derivado, que puede recalcularse si el pedido se edita). Son necesidades de consistencia distintas: `Income` no se recalcula solo; `ShopifyOrder` sí, cada vez que el pedido cambia.

### 2.1.b. El destino del income lo decide el gateway, no la conexión

La versión inicial de este diseño fijaba una única cuenta por conexión. Se cambia: el `account_id` de cada income se resuelve desde el **gateway de su transacción**, con la cuenta de la conexión como valor por defecto para gateways sin mapear.

El motivo es que la cuenta única rompe en cuanto una tienda cobra por más de un medio. Si el efectivo entra a una caja física y la tarjeta a un banco, ambos ingresos caen en la misma cuenta y su `computed_balance` pasa a ser la suma de dos sitios distintos — un número que no corresponde a ningún saldo real. Eso inutiliza el `drift` del reporte de caja (`reports-aggregation.service.ts`), cuya única razón de existir es poder cuadrar cada cuenta contra su fuente: un arqueo de caja o un estado de cuenta bancario.

La decisión 2 (un income por transacción) ya deja el gateway disponible en cada movimiento, así que no hace falta pedirle nada nuevo a Shopify: es sólo cuestión de usar un dato que ya se tiene.

**Modelo:** tabla `shopify_gateway_accounts` (`shopify_connection_id`, `gateway`, `account_id`), con único compuesto sobre `(shopify_connection_id, gateway)`.

*Alternativa descartada:* una columna JSON en `shopify_connections`. Se descarta porque `account_id` es una clave foránea real —borrar una cuenta mapeada debe fallar o avisar, no dejar un identificador huérfano dentro de un JSON— y porque el conjunto de gateways es pequeño y consultable, justo lo que una tabla resuelve mejor.

**Los mapeos no son retroactivos.** Cambiar la cuenta de un gateway afecta sólo a las transacciones nuevas; los incomes ya creados conservan el `account_id` con el que nacieron. Es coherente con la decisión 2.2 (lo sincronizado se congela) y evita que un cambio de configuración reescriba el histórico contable de forma silenciosa. La contrapartida es que corregir un mapeo mal puesto exige reasignar a mano los incomes afectados.

### 2.2. El costo se captura y se congela al sincronizar, nunca se recalcula después

Como Shopify no guarda un histórico de costo por pedido (decisión de Context), la única opción es leer `InventoryItem.unitCost` en el momento en que el pedido llega a paldex, y almacenar ese valor de forma permanente en el `ShopifyOrder`. Un cambio de costo posterior en el catálogo de Shopify no debe alterar pedidos ya sincronizados.

*Consecuencia que hay que asumir:* si el costo real en el momento de la venta fue distinto del costo configurado en Shopify en ese instante — por ejemplo, si el merchant actualiza el costo con retraso respecto a cuándo compró el inventario —, ese desfase se hereda en la ganancia calculada. No hay forma de evitarlo con los datos que Shopify expone; es una limitación del origen de datos, no de este diseño.

*Cuándo se captura:* al recibir `orders/create` (el pedido recién colocado) y de nuevo en cada `orders/updated` (por si el pedido se edita antes o después de pagarse). Cada captura usa el costo vigente en ese momento — no hay versionado de costo dentro de un mismo pedido; si el costo cambia entre una edición y otra, la segunda captura sencillamente sobrescribe con el valor nuevo.

### 2.3. El costo faltante se marca, nunca se trata como cero

Un producto puede haberse borrado del catálogo entre la venta y el momento de sincronizar (típicamente durante el backfill histórico), dejando su costo irrecuperable.

La opción fácil — tratar el costo como $0 — es también la más peligrosa: infla la ganancia de forma silenciosa, exactamente en el sentido que puede llevar a una mala decisión de negocio ("este producto es puro margen" cuando en realidad no se sabe cuánto costó). Se descarta sin ambigüedad.

En su lugar: la línea sin costo se excluye de la suma de ganancia, y el `ShopifyOrder` completo se marca `has_missing_cost_data: true`. La ganancia queda como **parcial y señalada como tal**, nunca como un número completo que en realidad no lo es.

*Por qué no estimar el costo de otra forma (promedio de costos de productos similares, último costo conocido de un histórico propio, etc.):* cualquier estimación es una invención que se presenta con la misma confianza que un dato real, y el usuario no tiene forma de distinguir un costo medido de uno adivinado sin que el sistema se lo diga explícitamente. La marca `has_missing_cost_data` es honesta; una estimación silenciosa no lo es.

### 2.4. Descuento: se usa la asignación de Shopify, no se recalcula la regla

`LineItem.discountAllocations` da, para cada línea, el monto de descuento que Shopify ya calculó y asignó — sin importar si la regla de descuento vivía a nivel de pedido completo o de producto específico. Se usa ese valor directamente.

*Por qué no reconstruir la regla de descuento (leer `DiscountApplication` e inferir a qué se aplica):* sería reimplementar la lógica de asignación de descuentos de Shopify — que contempla descuentos combinados, códigos automáticos, descuentos de envío excluidos, etc. — para llegar exactamente al número que `discountAllocations` ya da resuelto. Es trabajo redundante con más superficie de error que la fuente original.

### 2.5. IVA con fórmula de impuesto incluido, y la ganancia lo excluye

Con `taxesIncluded: true` (el caso confirmado para las tiendas que se van a conectar), el IVA es una porción del precio ya cobrado: `IVA = (tasa × precio) / (1 + tasa)`. El ingreso neto de una línea es su precio con descuento menos ese IVA, y la ganancia es ese ingreso neto menos el costo.

*Por qué restar el IVA de la ganancia:* es dinero que el negocio cobra pero que legalmente debe al SAT — no es suyo, aunque haya pasado por su cuenta. Una ganancia que no lo excluye sobrestima sistemáticamente cuánto se ganó, en un ~16% constante. Fue una decisión explícita, no una inferencia.

### 2.6. Un reembolso ajusta el `ShopifyOrder`, en proporción a lo devuelto

`refunds/create` incluye `refund_line_items`, con la cantidad devuelta de cada línea. Se usa esa cantidad para reducir, proporcionalmente, el ingreso neto, el IVA, el costo y la ganancia de la línea afectada dentro del `ShopifyOrder` — en paralelo al ajuste que ese mismo reembolso ya hace sobre el `Income` (decisión 4).

*Por qué es necesario y no un extra:* sin este ajuste, un pedido con una devolución seguiría mostrando la ganancia de una venta que, en la práctica, no se concretó del todo. Dado que "ganancia" es el dato que motiva este change, dejarlo sin corregir tras un reembolso lo volvería engañoso justo en el caso — una devolución — donde más importa que sea correcto.

### 2.7. Nuevos webhooks y nuevo scope

Se añaden `orders/create` y `orders/updated` a las suscripciones registradas al conectar, específicamente para alimentar `ShopifyOrder` — son independientes del flujo de `order_transactions/create`, que sigue existiendo sólo para crear `Income`.

Leer `InventoryItem.unitCost` requiere el scope `read_inventory`, además del `read_orders` ya necesario para lo demás. Se añade a `SHOPIFY_SCOPES`.

### 2.8. `line_items` como JSON, no como tabla normalizada

El desglose por línea de un `ShopifyOrder` se guarda como una columna JSON — un array de objetos con producto, cantidad, precio, descuento, costo, IVA y ganancia — en vez de una tabla `ShopifyOrderLineItem` separada.

*Por qué:* nada en este change necesita consultar o filtrar por línea de producto de forma independiente — no hay ningún endpoint que pida "todas las líneas que vendieron el producto X". El desglose se lee siempre completo, junto con su pedido. Normalizarlo en una tabla añadiría una migración, un modelo y una relación más sin que ningún requisito de este change los use.

*Cuándo dejaría de ser correcto:* si en el futuro se pide reportar rentabilidad por producto a través de pedidos — eso sí exige poder agrupar y filtrar por línea, y en ese momento la normalización deja de ser prematura. Se señala como pregunta abierta.

### 2.9. La conexión valida la moneda de la tienda

Al completar el callback de OAuth, antes de crear la `ShopifyConnection`, se consulta la moneda de la tienda (`Shop.currencyCode`) y se rechaza la conexión si no es `MXN`.

*Por qué aquí y no dejarlo como supuesto documentado:* a diferencia de otros riesgos de este change que sí se documentan sin resolver (ver Non-Goals), la moneda es la única precondición que se puede verificar con una sola consulta antes de dejar entrar ningún dato. Convertir un supuesto en una validación activa es barato cuando el dato ya está disponible en el propio flujo de conexión — coherente con el patrón de denegación por defecto que el resto del sistema ya sigue.

### 3. `order_transactions/create` como filtro, no como disparo directo

El webhook se dispara tanto al crear una transacción como al cambiar su estado — una autorización pendiente puede disparar el webhook y, más tarde, su captura exitosa dispara el mismo webhook de nuevo. El handler filtra: sólo `kind IN (sale, capture)` y `status = success` generan un `Income`. Todo lo demás se reconoce y se descarta sin error.

*Por qué no filtrar en el registro del webhook (suscribirse sólo quando el estado ya es success):* Shopify no ofrece ese filtro a nivel de suscripción; el filtrado por contenido del payload es la única opción, y es barato — no implica ninguna llamada adicional a la API.

### 4. Reembolso: reducir o extinguir, nunca adivinar

Un reembolso trae en su payload las transacciones de tipo `refund`, cada una con `parent_id` apuntando a la transacción original. Se usa ese `parent_id` para localizar, por el identificador interno de transacción guardado en el income, cuál reducir.

- Si el monto reembolsado es menor que el monto actual del income → se reduce.
- Si es igual o mayor → se borra. Nunca se deja un monto negativo.
- Si no se encuentra el income de origen (por ejemplo, el usuario ya lo había borrado a mano) → **no se crea nada**. Adivinar a qué aplicar un reembolso huérfano es peor que dejar un caso sin resolver automáticamente; se registra para revisión manual.

*Consecuencia que hay que aceptar, no resolver:* como los incomes sincronizados son completamente editables (decisión 5), un reembolso siempre actúa sobre el **monto actual**, que puede no ser el monto original de la venta si el usuario ya lo tocó. Es una imprecisión de diseño consciente — la alternativa, bloquear la edición de incomes sincronizados, se descarta en la siguiente decisión.

### 5. Los incomes sincronizados no se bloquean

No se introduce ningún estado de "sólo lectura" para los incomes que provienen de Shopify. `PATCH /incomes/:id` funciona igual sobre ellos que sobre cualquier otro, salvo por los dos campos de trazabilidad, que quedan protegidos.

*Por qué no bloquear:* introducir un estado bloqueado exige tocar la spec de `incomes-crud` con una regla nueva y condicional ("editable salvo si viene de Shopify, salvo estos campos"), añade un `403` o `409` que no se pidió, y contradice el principio de que el usuario es dueño de sus datos financieros y puede corregir lo que sea — un income mal categorizado por un bug de mapeo debe poder arreglarse desde la UI normal sin esperar un fix de la integración.

*Coste:* descrito en la decisión 4. Se acepta.

### 6. Idempotencia vía columna única, no vía deduplicación aplicativa

`Income` gana `@@unique([source, external_transaction_id])`. Todo intento de crear un income para una transacción ya procesada — sea por reintento de webhook, por solape entre backfill y webhook, o por la reconciliación diaria — choca contra esa restricción y se resuelve como no-op, no como error.

*Por qué en base de datos y no comprobando antes de escribir:* una comprobación previa (`findFirst` seguido de `create`) tiene una ventana de carrera exactamente como la que ya se ha señalado en otros changes de este proyecto (`P2002`/`P2003`). Con backfill y webhooks pudiendo solaparse en el tiempo — un webhook de una venta reciente puede llegar mientras el backfill histórico todavía está corriendo —, esa ventana deja de ser teórica. La restricción única hace que la base de datos sea el árbitro final, y el código simplemente captura el conflicto y lo trata como éxito.

### 7. Contexto de propiedad explícito en `ShopifyConnection`, sin esperar a `add-user-data-scoping`

`ShopifyConnection` lleva su propio `user_id` desde el primer día, aunque `Account`, `Income` y `Expense` todavía no tengan propietario.

*Por qué no bloquear este change hasta que `add-user-data-scoping` esté implementado:* una conexión de Shopify es, por naturaleza, un recurso nuevo sin datos previos que migrar — no hay el problema de backfill de propietario que sí tienen las tablas existentes. Añadirle `user_id` de entrada no cuesta nada y evita atar un change de integración externa a la finalización de otro change de arquitectura interna.

*Lo que esto NO resuelve:* los `Income` que la sincronización crea siguen sin propietario hasta que `add-user-data-scoping` aplique su migración sobre `Income`. Mientras tanto, un income sincronizado es tan visible para cualquier usuario autenticado con permiso como cualquier otro income manual — ni mejor ni peor que el estado actual del resto del sistema. El endpoint `GET /shopify/connections` sí filtra por `user_id` desde ya, porque `ShopifyConnection` es su propia tabla con su propia columna.

### 8. OAuth externo con `state` firmado, no token exchange embebido

Shopify ofrece dos mecanismos de autenticación para apps: *token exchange* (para apps embebidas, que viven dentro del admin de Shopify) y el flujo clásico de *authorization code* (para apps externas). paldex no es una app embebida — es un sistema externo al que el usuario conecta su tienda desde fuera —, así que corresponde el segundo.

El problema práctico: el flujo de OAuth es una navegación de página completa (redirect del navegador), no una llamada `fetch` con cabeceras. El JWT de paldex, que normalmente viaja en `Authorization`, no puede adjuntarse a una redirección. Sin embargo, el callback final necesita saber a qué usuario y a qué cuenta de paldex pertenece la conexión que se está completando.

*Solución:* `POST /shopify/connections/install` (llamada autenticada normal, con JWT) genera un `state` — un token firmado de corta duración que codifica `{ user_id, account_id, nonce }` — y lo incluye en la URL de autorización que devuelve. Shopify lo devuelve intacto en el callback. El callback lo verifica (firma, caducidad, que el `nonce` no se haya usado antes) y así recupera quién inició la conexión sin depender de sesión de navegador ni de cookies.

*Alternativa descartada:* sesión de servidor con cookie. Añadiría un mecanismo de sesión que el resto del proyecto no tiene — todo lo demás es JWT sin estado — para resolver un problema que un token firmado de un solo uso resuelve igual de bien y de forma consistente con el resto del sistema.

### 9. Verificación de HMAC antes de que el pipeline global toque el body

Los webhooks de Shopify se autentican firmando el **cuerpo crudo** de la petición con el secreto de la app (`X-Shopify-Hmac-Sha256`). El `ValidationPipe` global de `main.ts` y el parseo JSON estándar de Express transforman el body antes de que un guard normal pueda verlo en su forma original — verificar contra un JSON ya parseado y reserializado no es fiable, porque la reserialización puede no ser byte a byte idéntica a lo que Shopify firmó.

Nest ofrece soporte nativo para esto: `NestFactory.create(AppModule, { rawBody: true })` deja el cuerpo crudo disponible en `request.rawBody` sin dejar de parsear el JSON normal para el resto de la app. Un `ShopifyWebhookGuard` dedicado — distinto del `AuthGuard`/`PermissionsGuard` de paldex, porque Shopify no manda un JWT de paldex — verifica el HMAC contra `request.rawBody` antes de que el handler procese nada.

*Por qué un guard propio y no reutilizar `AuthGuard`:* la autenticación de un webhook de Shopify no tiene nada que ver con la de un usuario de paldex — es una firma criptográfica contra un secreto compartido con Shopify, no un JWT. Mezclarlos en el mismo guard obligaría a ese guard a saber distinguir dos protocolos de autenticación completamente distintos.

### 10. Cifrado del token de acceso a nivel de aplicación

El proyecto no tiene gestor de secretos (Vault, KMS). Se cifra el `access_token` con AES-256-GCM antes de escribirlo, usando una clave de una variable de entorno (`SHOPIFY_TOKEN_ENCRYPTION_KEY`), y se descifra sólo en el momento de hacer una llamada a la Admin API de la tienda.

*Por qué no texto plano:* un volcado de la tabla `shopify_connections`, un backup mal guardado o un acceso no autorizado a la base de datos expondría credenciales que dan control sobre la tienda de un tercero — un nivel de exposición distinto al de cualquier otro dato del sistema hasta ahora.

*Por qué no un gestor de secretos dedicado:* sería la solución correcta a mayor escala, pero introducir esa pieza de infraestructura sólo para este change es desproporcionado para el tamaño actual del proyecto. El cifrado a nivel de aplicación es la opción intermedia — mejor que texto plano, sin añadir un servicio nuevo al `docker-compose.yml`.

*Riesgo que esto no resuelve:* si `SHOPIFY_TOKEN_ENCRYPTION_KEY` se compromete junto con la base de datos, el cifrado no protege nada — no hay separación entre quien guarda la clave y quien guarda los datos cifrados, que es justo lo que un gestor de secretos aportaría.

### 11. Sin ingestión de datos personales del comprador

Sólo se leen de cada transacción los campos financieros: monto, moneda, `gateway`, fecha, identificador del pedido. No se toca `order.customer`, `order.billing_address` ni `order.shipping_address`.

*Por qué:* además de no ser necesario para el propósito de este change (llevar la contabilidad del vendedor, no un CRM de sus clientes), simplifica de raíz el cumplimiento de `customers/redact` — si no se guarda ningún dato personal de un comprador, no hay nada que borrar cuando Shopify lo pida, y el webhook de cumplimiento responde `200` de inmediato en vez de tener que ejecutar una purga real.

### 12. Reconciliación diaria, con consulta normal, no en bloque — y cubre pedidos, no sólo transacciones

La reconciliación usa una consulta GraphQL corriente (no `bulkOperationRunQuery`), filtrando por `updated_at` desde la última sincronización de cada conexión. Consulta **tanto transacciones como pedidos modificados**, y aplica a cada uno el mismo mapeo que su webhook correspondiente — transacciones hacia `Income`, pedidos hacia `ShopifyOrder`.

*Por qué no bulk también aquí:* Bulk Operations tiene su propio coste de orquestación — encolar, esperar, descargar un JSONL — que tiene sentido para un histórico completo pero es desproporcionado para una comprobación diaria de "qué cambió desde ayer", que en la inmensa mayoría de los casos son unas pocas transacciones y pedidos. Como el coste de la API es por complejidad y por tienda, una consulta diaria modesta por conexión activa es barata incluso con muchas tiendas conectadas — cada tienda-app tiene su propio balance, así que no hay contención entre usuarios distintos.

*Por qué incluir pedidos y no sólo transacciones:* `orders/updated` puede perderse igual que cualquier otro webhook, y si eso ocurre, el `ShopifyOrder` de ese pedido queda con un descuento o un costo obsoleto sin que nada lo note — silenciosamente, en el dato que es el propósito entero de este change. Limitar la reconciliación al dinero (`Income`) y dejar la ganancia sin la misma red de seguridad sería inconsistente con cuánto le importa a este change que la ganancia sea correcta.

## Risks / Trade-offs

- **La ganancia depende de un dato que Shopify no versiona (el costo)** → Es el riesgo estructural de todo este change: no existe forma, vía la API de Shopify, de conocer con certeza absoluta el costo exacto que tenía un producto en el instante preciso de una venta pasada; sólo se puede capturar el costo vigente en el momento de sincronizar, que en la inmensa mayoría de los casos (webhooks casi instantáneos) coincide, pero no hay garantía matemática de ello. Mitigación parcial: capturar tan pronto como sea posible (al crear el pedido, no al pagarlo) y marcar explícitamente los casos donde el dato ni siquiera eso se puede obtener (decisión 2.3).

- **La conversión de moneda queda fuera, pero ahora con una validación activa** → A diferencia de un supuesto documentado sin verificar, la moneda MXN se comprueba al conectar (decisión 2.9) y la conexión se rechaza si no coincide. El riesgo que queda es menor: sólo aplica si Shopify permite que una tienda reporte `MXN` pero factura en la práctica en otra moneda por configuración de mercados internacionales (`Markets`), algo que este change no audita en detalle.

- **La clave de cifrado y los datos cifrados viven en el mismo perímetro** → Descrito en la decisión 10. Es la limitación esperable de cifrado a nivel de aplicación sin gestor de secretos, aceptada por el tamaño actual del proyecto.

- **Un reembolso sobre un income editado a mano pierde precisión** → Descrito en la decisión 4. Es la consecuencia directa de no bloquear la edición de incomes sincronizados (decisión 5), que se prefiere sobre la alternativa de introducir un estado de sólo lectura.

- **La reconciliación no cubre huecos infinitos** → Si una conexión lleva mucho tiempo con webhooks fallando sin que nadie lo note, y la reconciliación sólo mira "desde la última sincronización", un fallo prolongado puede dejar una ventana sin cubrir si `last_synced_at` no se actualiza correctamente en cada pasada. Mitigación: la reconciliación debe actualizar `last_synced_at` sólo tras procesar con éxito, nunca de forma optimista antes de terminar.

- **Sin cola de procesamiento** → Los webhooks se procesan síncronamente dentro del propio handler HTTP. Para el volumen esperado de este proyecto (tiendas pequeñas, uso personal) es razonable, pero significa que un pico de eventos o una lentitud puntual de la base de datos se traduce directamente en latencia de respuesta al webhook, y Shopify puede reintentar si el timeout se agota. Si el volumen crece, la evolución natural es encolar (Bull/Redis) y responder `200` de inmediato tras encolar. No se construye aquí porque añadir una cola para un volumen que no existe todavía es la abstracción prematura que este proyecto ha evitado en cada change anterior.

- **Una tienda sólo puede conectarse a un usuario de paldex a la vez** → Descrito como non-goal. Si dos personas del mismo negocio quisieran ver la misma tienda desde sus propias cuentas de paldex, este diseño no lo permite sin desconectar y reconectar. Coherente con el resto del sistema, que ya asumió aislamiento estricto por usuario en `add-user-data-scoping`.

- **Investigación de API con fecha de caducidad** → Los nombres exactos de topics de webhook, límites y comportamiento de Bulk Operations se verificaron en julio de 2026 contra la documentación pública de Shopify. Shopify versiona su API trimestralmente; antes de implementar, conviene reconfirmar contra `shopify.dev` la versión vigente en ese momento, en particular el nombre exacto del topic `ORDER_TRANSACTIONS_CREATE` y el mecanismo de notificación de finalización de Bulk Operations, que no se verificó con el mismo nivel de detalle que el resto.

## Migration Plan

**Base de datos:**
1. Nueva tabla `shopify_connections`, sin backfill — no hay datos previos.
2. Nueva tabla `shopify_orders`: desglose por pedido, con `line_items` como JSON (decisión 2.8).
3. Nuevas columnas en `incomes`: `source`, `external_transaction_id`, `external_reference`, `shopify_order_id` (FK nullable a `shopify_orders`), todas nullable — no rompe filas existentes, todas quedan a `null`.
4. `@@unique([source, external_transaction_id])` sobre `incomes` — MySQL permite múltiples `NULL` en un índice único, así que no afecta a los incomes manuales.
5. Nueva tabla `shopify_gateway_accounts` (`shopify_connection_id`, `gateway`, `account_id`) con único compuesto sobre `(shopify_connection_id, gateway)` — decisión 2.1.b. Sin backfill: las conexiones existentes se quedan sin mapeos y todo cae en su cuenta por defecto, que es exactamente el comportamiento anterior.

**Infraestructura** (hecho el 2026-08-11, salvo lo indicado):

1. ~~Registrar la app en el Partner Dashboard~~ → **El Partner Dashboard ya no se usa para esto.** Desde el 1 de enero de 2026 las apps se crean en el **Dev Dashboard** (`dev.shopify.com/dashboard`), y el camino viejo de custom app desde el admin de la tienda está discontinuado. Cambia además dónde vive cada cosa: el Client ID y el secret están en *Settings*, mientras que los scopes y las URLs de redirección se configuran creando una versión en la pestaña *Versions*. La distribución se elige una sola vez y **no se puede cambiar después**: para una tienda propia corresponde *Custom distribution*.
2. Variables cargadas en Coolify, todas de runtime: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_TOKEN_ENCRYPTION_KEY`, `SHOPIFY_SCOPES`, `SHOPIFY_CALLBACK_URL` y `SHOPIFY_FRONTEND_URL`. Las dos últimas faltaban en la lista original: sin `SHOPIFY_FRONTEND_URL` el callback devuelve el navegador a `localhost:3002`, y `SHOPIFY_CALLBACK_URL` debe coincidir carácter por carácter con la URL de redirección declarada en la versión de la app.
3. `SHOPIFY_SCOPES` es `read_orders,read_products,read_inventory`. `read_products` no estaba en la lista original y hace falta: la resolución de categoría lee `productType`, `collections` y `tags`, que sin ese scope llegan vacíos y mandan todo a `UNKNOWN`.
4. Los tres webhooks de cumplimiento **no se registran**: sólo son obligatorios para apps distribuidas por el App Store, y ésta es de distribución custom. Los endpoints existen igualmente. En el Dev Dashboard tampoco se configuran ya por interfaz — irían en `shopify.app.toml` vía Shopify CLI.
5. **Pendiente:** aprobación de `read_all_orders`, solicitada y en espera. Sin ella el backfill sólo alcanza los últimos 60 días. Cuando la aprueben hay que añadir el scope, **reinstalar la app en la tienda** —los scopes se conceden al instalar, no al cambiarlos— y volver a correr el backfill, que es idempotente por transacción y no duplica lo ya sincronizado.
6. Los webhooks de pedidos (`ORDER_TRANSACTIONS_CREATE`, `REFUNDS_CREATE`, `ORDERS_CREATE`, `ORDERS_UPDATED`) **no se registran hasta que sus handlers hagan algo**. Hoy son stubs que responden `200`: registrarlos antes haría que Shopify entregue eventos que se descartan en silencio, dando por sincronizado lo que no lo está.

*Estado de la API reverificado el 2026-08-11*: `2026-07` sigue siendo la versión estable (`2026-10` está como release candidate) y los cuatro topics de webhook del diseño siguen existiendo con el mismo nombre.

**Orden de despliegue:**
1. Migración de esquema.
2. Despliegue del código con los endpoints de conexión y sincronización.
3. Registro de la app en Shopify con la URL de callback ya apuntando al entorno de producción.
4. Prueba end-to-end con una tienda de desarrollo (Shopify ofrece tiendas de prueba gratuitas para desarrolladores) antes de conectar una tienda real.

**Rollback:** revertir el código deja las tablas nuevas sin uso, sin afectar al resto del sistema. Revertir la migración exige antes desconectar cualquier `ShopifyConnection` activa y decidir qué hacer con los incomes ya sincronizados (se quedan, sin sus columnas de trazabilidad si se revierte también esa parte del esquema).

## Open Questions

- ¿Qué pasa si el mismo negocio quiere que dos personas distintas de su equipo vean la misma tienda? Hoy no es posible sin el modelo de espacio compartido que se descartó en `add-user-data-scoping`.
- Los reembolsos sin income de origen encontrado quedan "registrados para revisión" — ¿dónde vive esa revisión? Este change no define una pantalla ni un endpoint para consultarlos, sólo que se registran (por ejemplo, en el log de aplicación). Si el volumen de estos casos resulta no ser trivial, hará falta una cola de incidencias de sincronización visible para el usuario.
- ¿Vale la pena registrar también `orders/cancelled` para marcar de alguna forma los pedidos cancelados, aunque el dinero no se mueva hasta que haya un reembolso explícito?
- ¿En qué momento deja de ser prematuro normalizar `line_items` en su propia tabla? En cuanto se pida un reporte de rentabilidad por producto a través de pedidos, la respuesta es "ahora" (decisión 2.8).
- ~~¿Debe el destino del income depender del gateway de pago, en vez de ser fijo por conexión?~~ **Resuelto el 2026-08-11**: sí. Ver decisión 2.1.b. Se resolvió antes de implementar la ingesta, que era la condición — con incomes ya sincronizados habría sido una migración de datos en vez de un cambio de configuración.
- La pantalla para configurar el mapeo `gateway → cuenta` no entra aquí: este change declara el frontend fuera de alcance. El backend expone la configuración; la interfaz va en un change propio de `paldex-app`. Hasta que exista, el mapeo sólo es editable vía API.
- ¿Qué hacer si se borra una cuenta que está mapeada a un gateway? La FK impide dejarla huérfana, pero falta decidir si el borrado se rechaza o si el mapeo cae al valor por defecto.
