## ADDED Requirements

### Requirement: Cada transacción exitosa genera un Income propio

El sistema SHALL crear un `Income` por cada transacción de Shopify cuyo `kind` sea `sale` o `capture` y cuyo `status` sea `success`. Transacciones de otro `kind` (`authorization`, `void`, `refund`) o con `status` distinto de `success` MUST NOT generar ningún `Income`.

Cuando un pedido se paga con más de un método, cada transacción exitosa MUST generar su propio `Income`, con el monto correspondiente a esa transacción, no al pedido completo.

#### Scenario: Transacción única

- **WHEN** llega una transacción con `kind: sale`, `status: success`, `amount: 20.00` para el pedido 1001
- **THEN** el sistema crea un `Income` de monto 20.00 referenciando esa transacción

#### Scenario: Pedido pagado con dos métodos

- **WHEN** el pedido 1001 de $20 se paga con dos transacciones exitosas de $10 cada una, con distinto `gateway`
- **THEN** el sistema crea dos `Income` de $10 cada uno, cada uno con su propia referencia de transacción y su propio método de pago

#### Scenario: Autorización sin captura

- **WHEN** llega una transacción con `kind: authorization`, `status: success`
- **THEN** el sistema no crea ningún `Income`

#### Scenario: Transacción fallida

- **WHEN** llega una transacción con `kind: sale`, `status: failure`
- **THEN** el sistema no crea ningún `Income`

#### Scenario: Notificación de cambio de estado de una transacción ya vista

- **WHEN** el mismo `order_transactions/create` se recibe de nuevo porque una transacción cambió de `pending` a `success`
- **THEN** el sistema crea el `Income` correspondiente a ese cambio de estado, sin duplicar ningún ingreso ya creado para esa misma transacción

### Requirement: El income generado lleva trazabilidad de origen

El `Income` creado a partir de una transacción de Shopify SHALL registrar `source: "shopify"`, un identificador interno de la transacción de origen para permitir la idempotencia y el casamiento de reembolsos, `external_reference` como texto legible que identifica el pedido y el método de pago, y una referencia al `ShopifyOrder` de su pedido.

El campo `account_id` del income MUST ser el configurado en la `ShopifyConnection` correspondiente, no un valor por transacción.

#### Scenario: El income enlaza con el snapshot financiero de su pedido

- **WHEN** se crea un `Income` a partir de una transacción de un pedido cuyo `ShopifyOrder` ya existe
- **THEN** el income queda enlazado a ese `ShopifyOrder`

#### Scenario: La transacción llega antes que los datos del pedido

- **WHEN** llega una transacción exitosa de un pedido cuyo `ShopifyOrder` todavía no se ha sincronizado
- **THEN** el sistema crea igualmente el `Income` — el dinero recibido no espera a que el desglose de costo y ganancia esté listo — y lo enlaza al `ShopifyOrder` en cuanto éste se sincronice

#### Scenario: Campos de trazabilidad presentes

- **WHEN** se consulta por API un `Income` creado por la sincronización
- **THEN** su `source` es `"shopify"` y su `external_reference` identifica el pedido y el gateway de pago

#### Scenario: Un income manual no lleva estos campos

- **WHEN** se consulta por API un `Income` creado manualmente vía `POST /incomes`
- **THEN** su `source` es `null` y su `external_reference` es `null`

#### Scenario: El destino es el configurado en la conexión

- **WHEN** una conexión tiene configurada la cuenta 3 como destino y llega una transacción exitosa de esa tienda
- **THEN** el `Income` creado tiene `account_id: 3`

### Requirement: Idempotencia frente a reintentos y redundancia

El sistema SHALL garantizar que una misma transacción de Shopify no genere más de un `Income`, sin importar cuántas veces se reciba su notificación por webhook, por reconciliación o por la carga inicial.

#### Scenario: Webhook duplicado

- **WHEN** Shopify reenvía la misma notificación de una transacción ya procesada, con el mismo identificador
- **THEN** el sistema no crea un segundo `Income` y responde `200 OK`

#### Scenario: La misma transacción llega por webhook y por reconciliación

- **WHEN** una transacción ya sincronizada por webhook aparece de nuevo en la consulta de reconciliación
- **THEN** el sistema la reconoce como ya procesada y no crea un `Income` adicional

#### Scenario: La carga inicial no duplica lo que un webhook ya procesó

- **WHEN** la carga inicial de histórico incluye una transacción que un webhook, llegado antes de que la carga terminara, ya había convertido en `Income`
- **THEN** el sistema no crea un segundo `Income` para esa transacción

### Requirement: Un reembolso reduce o extingue el income original

Cuando llegue un reembolso de Shopify, el sistema SHALL localizar el `Income` cuya transacción de origen coincide con la transacción reembolsada. Si el monto reembolsado es menor que el monto actual del income, el sistema SHALL reducir su monto en esa cantidad. Si es igual o mayor, el sistema SHALL borrar el income.

Si no se encuentra ningún income con esa transacción de origen, el sistema MUST NOT crear un income negativo ni adivinar a qué aplicar el reembolso; MUST registrar el caso para revisión.

#### Scenario: Reembolso parcial

- **WHEN** llega un reembolso de $5 sobre una transacción cuyo income asociado tiene un monto de $20
- **THEN** el income pasa a tener un monto de $15

#### Scenario: Reembolso total

- **WHEN** llega un reembolso de $20 sobre una transacción cuyo income asociado tiene un monto de $20
- **THEN** el income se borra

#### Scenario: Reembolso mayor que el income restante

- **WHEN** llega un reembolso de $25 sobre una transacción cuyo income asociado tiene actualmente un monto de $20
- **THEN** el income se borra, sin dejar un monto negativo

#### Scenario: Reembolsos parciales sucesivos

- **WHEN** un income de $20 recibe un reembolso de $5 y después otro de $5
- **THEN** tras ambos, el income tiene un monto de $10

#### Scenario: No se encuentra la transacción de origen

- **WHEN** llega un reembolso cuya transacción original no corresponde a ningún income existente — por ejemplo, porque el usuario ya lo había borrado manualmente
- **THEN** el sistema no crea ningún income nuevo, no falla la petición, y deja constancia del caso para revisión manual

#### Scenario: El income fue editado manualmente antes del reembolso

- **WHEN** un usuario cambió a mano el monto de un income sincronizado y después llega un reembolso sobre su transacción de origen
- **THEN** el sistema aplica la reducción sobre el monto actual del income, no sobre el monto original de la transacción de Shopify

### Requirement: Carga inicial del histórico

Al completarse una conexión, el sistema SHALL importar las transacciones exitosas existentes de la tienda usando una operación en bloque de la GraphQL Admin API, sin usar el presupuesto de límite de peticiones normal.

La carga inicial MUST usar el mismo mapeo de transacción a income que el procesamiento de webhooks, y MUST respetar la misma idempotencia.

#### Scenario: Backfill tras conectar

- **WHEN** se completa la conexión de una tienda con historial de ventas
- **THEN** el sistema encola una operación en bloque que, al finalizar, crea un `Income` por cada transacción exitosa histórica

#### Scenario: El backfill no bloquea la respuesta de conexión

- **WHEN** un usuario completa la autorización de una tienda con miles de transacciones históricas
- **THEN** el callback de OAuth responde sin esperar a que la carga termine, y la conexión queda visible como `ACTIVE` mientras la carga corre en segundo plano

### Requirement: Reconciliación periódica

El sistema SHALL ejecutar, para cada conexión `ACTIVE`, una comprobación periódica que consulte las transacciones modificadas desde la última sincronización y aplique el mismo mapeo e idempotencia que los webhooks, como red de seguridad frente a entregas de webhook perdidas.

#### Scenario: Reconciliación detecta una transacción que el webhook no entregó

- **WHEN** una transacción exitosa nunca disparó su webhook por una caída temporal del endpoint, y la conexión sigue activa
- **THEN** la siguiente reconciliación periódica la detecta y crea el `Income` correspondiente

#### Scenario: Reconciliación no reprocesa lo ya sincronizado

- **WHEN** la reconciliación revisa transacciones que ya generaron su income por webhook
- **THEN** no crea ningún income adicional para ellas

### Requirement: Cada pedido tiene un snapshot financiero propio

El sistema SHALL mantener un registro `ShopifyOrder` por cada pedido de Shopify, independiente de los `Income` que ese pedido genere, con el desglose por línea de producto: precio original, descuento asignado, IVA, costo y ganancia.

Este registro MUST reflejar la economía del pedido tal como fue colocado, y MUST NOT depender de si el pedido llegó a pagarse — un pedido pendiente de pago SHALL tener su snapshot financiero igual que uno ya cobrado; lo que determina si hubo dinero real es la existencia de sus `Income`, no la existencia de su `ShopifyOrder`.

#### Scenario: Snapshot creado al colocarse el pedido

- **WHEN** llega la notificación de un pedido nuevo con sus líneas de producto
- **THEN** el sistema crea un `ShopifyOrder` con el desglose por línea, sin esperar a que el pago se confirme

#### Scenario: El snapshot se actualiza si el pedido se edita

- **WHEN** un pedido ya sincronizado cambia — se añade una línea, cambia un descuento — antes o después de haberse pagado
- **THEN** el sistema recalcula el `ShopifyOrder` con los datos actuales del pedido

#### Scenario: El total del pedido no incluye envío

- **WHEN** se calcula el total de un `ShopifyOrder`
- **THEN** el total SHALL sumar únicamente las líneas de producto, sin incluir el cargo de envío

### Requirement: El descuento se toma de la asignación real de Shopify, no se recalcula

El sistema SHALL tomar el descuento de cada línea del valor que Shopify ya asignó a esa línea (`discountAllocations`), sin importar si el descuento se configuró a nivel de pedido completo o de producto específico — Shopify ya resuelve esa distinción antes de que los datos lleguen al sistema.

#### Scenario: Descuento configurado sobre todo el pedido

- **WHEN** un pedido con dos líneas de $100 cada una tiene un descuento del 10% aplicado al pedido completo
- **THEN** cada línea del `ShopifyOrder` refleja $10 de descuento, tomado de la asignación que Shopify ya calculó para esa línea

#### Scenario: Descuento configurado sobre un producto específico

- **WHEN** un pedido tiene un descuento aplicado únicamente a una de sus dos líneas
- **THEN** sólo esa línea del `ShopifyOrder` refleja descuento; la otra queda en $0 de descuento

### Requirement: El costo se congela en el momento de la sincronización

El sistema SHALL obtener el costo unitario de cada línea desde el costo actual del artículo de inventario de Shopify en el momento en que el pedido se sincroniza, y SHALL almacenarlo de forma permanente en el `ShopifyOrder` — no MUST recalcularse consultando el costo vigente en un momento posterior.

Dado que Shopify no conserva un histórico del costo por pedido, el sistema MUST asumir que el costo capturado en el momento de la sincronización es el costo válido para ese pedido, aunque el costo del producto cambie más adelante en el catálogo de la tienda.

#### Scenario: El costo se guarda al sincronizar

- **WHEN** se sincroniza un pedido cuyo producto tiene hoy un costo unitario de $30
- **THEN** el `ShopifyOrder` guarda $30 como costo unitario de esa línea, de forma permanente

#### Scenario: Un cambio de costo posterior no altera pedidos ya sincronizados

- **WHEN** el costo unitario de un producto cambia en Shopify después de que un pedido con ese producto ya fue sincronizado
- **THEN** el `ShopifyOrder` de ese pedido conserva el costo que tenía en el momento de la sincronización, sin actualizarse

### Requirement: El costo faltante se marca como incompleto, nunca como cero

Cuando el sistema no pueda obtener el costo de una línea — por ejemplo, porque el producto o la variante fue borrado del catálogo —, el sistema MUST NOT tratar ese costo como $0. MUST marcar la línea y el pedido como de costo incompleto, y el cálculo de ganancia de ese pedido MUST señalarse como no confiable.

#### Scenario: Producto borrado del catálogo

- **WHEN** se sincroniza un pedido histórico cuyo producto ya no existe en el catálogo de la tienda
- **THEN** el sistema marca esa línea con costo desconocido, marca el `ShopifyOrder` como `has_missing_cost_data: true`, y no incluye esa línea en el cálculo de ganancia como si costara $0

#### Scenario: Un pedido con datos completos no lleva la marca

- **WHEN** todas las líneas de un pedido tienen su costo disponible
- **THEN** el `ShopifyOrder` tiene `has_missing_cost_data: false`

### Requirement: El IVA se calcula sobre precio con impuesto incluido

Dado que las tiendas conectadas operan con precios que incluyen IVA, el sistema SHALL calcular el IVA de cada línea usando la fórmula de impuesto incluido — el IVA es una porción del precio ya cobrado, no un monto que se suma aparte —, y SHALL usar ese IVA para obtener el ingreso neto de la línea antes de calcular la ganancia.

#### Scenario: Cálculo del IVA incluido

- **WHEN** una línea tiene un precio final (ya con descuento) de $116 y una tasa de IVA del 16%
- **THEN** el sistema calcula el IVA de esa línea como $16, y el ingreso neto de la línea como $100

#### Scenario: El IVA no se suma al total

- **WHEN** se calcula el total de un `ShopifyOrder`
- **THEN** el IVA no se añade por encima del precio de las líneas — ya está incluido en ellas

### Requirement: La ganancia excluye el IVA cobrado y el costo de los productos

El sistema SHALL calcular la ganancia de cada línea como su ingreso neto (precio con descuento aplicado, menos IVA) menos su costo. La ganancia del pedido SHALL ser la suma de la ganancia de sus líneas.

Cuando una línea tenga costo desconocido, esa línea MUST excluirse de la suma de ganancia del pedido, y el pedido MUST llevar la marca de datos incompletos correspondiente — la ganancia del pedido en ese caso es parcial, no cero ni una estimación completa.

#### Scenario: Cálculo de ganancia con datos completos

- **WHEN** una línea tiene un precio con descuento e IVA incluido de $232, una tasa de IVA del 16%, y un costo unitario de $80 para una unidad
- **THEN** el ingreso neto de la línea es $200, y su ganancia es $120

#### Scenario: Ganancia agregada del pedido

- **WHEN** un pedido tiene dos líneas con ganancias de $120 y $50 respectivamente
- **THEN** la ganancia del `ShopifyOrder` es $170

#### Scenario: Ganancia parcial por costo incompleto

- **WHEN** un pedido tiene una línea con ganancia calculable de $120 y otra sin costo disponible
- **THEN** la ganancia del `ShopifyOrder` es $120, marcada como parcial, sin incluir ninguna estimación para la línea sin costo

### Requirement: Un reembolso ajusta el snapshot financiero del pedido

Cuando llegue un reembolso que incluya devolución de artículos, el sistema SHALL reducir, en el `ShopifyOrder` correspondiente, el ingreso neto, el IVA, el costo y la ganancia de las líneas afectadas, en proporción a la cantidad devuelta.

#### Scenario: Devolución parcial de una línea

- **WHEN** un pedido tiene una línea de 2 unidades con ganancia de $240, y llega un reembolso que devuelve 1 de esas 2 unidades
- **THEN** la ganancia de esa línea en el `ShopifyOrder` se reduce a $120

#### Scenario: El ajuste del pedido es consistente con la reducción del income

- **WHEN** llega un reembolso que reduce tanto un `Income` como el `ShopifyOrder` de su pedido
- **THEN** ambos ajustes reflejan la misma operación de reembolso, sin que uno se actualice y el otro no

### Requirement: Verificación de firma en cada webhook de datos

Todo webhook de Shopify que no sea de cumplimiento SHALL verificar la firma HMAC contra el cuerpo crudo de la petición antes de procesar ningún dato, y MUST identificar la tienda de origen por el dominio incluido en la cabecera de la petición, resolviendo la conexión activa correspondiente.

#### Scenario: Firma válida

- **WHEN** llega `POST /shopify/webhooks/order-transactions-create` con una firma HMAC válida para una tienda con conexión activa
- **THEN** el sistema procesa la transacción

#### Scenario: Firma inválida

- **WHEN** llega un webhook de transacción u orden con una firma HMAC que no verifica
- **THEN** el sistema responde `401 Unauthorized` y no procesa ningún dato

#### Scenario: Webhook de una tienda sin conexión activa

- **WHEN** llega un webhook válido en su firma pero cuya tienda no tiene ninguna `ShopifyConnection` en estado `ACTIVE`
- **THEN** el sistema responde `200 OK` sin procesar nada, para que Shopify no reintente indefinidamente un webhook que nunca podrá cumplirse
