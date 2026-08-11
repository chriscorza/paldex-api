## ADDED Requirements

### Requirement: Iniciar la conexión de una tienda

El sistema SHALL exponer `POST /shopify/connections/install`, protegido por `shopify_connection:create`, que recibe `shop_domain` y `account_id` y devuelve la URL de autorización de Shopify a la que el cliente debe redirigir al navegador.

`shop_domain` MUST tener el formato `*.myshopify.com`. `account_id` MUST corresponder a una cuenta existente, y pasa a ser la **cuenta por defecto** de la conexión: la que reciben las transacciones cuyo gateway no tenga un mapeo explícito.

El sistema MUST generar un parámetro `state` firmado y de corta duración que identifique al usuario y a la cuenta elegida, para poder recuperarlos en el callback sin depender de una sesión de navegador.

#### Scenario: Solicitud de instalación correcta

- **WHEN** un usuario autenticado envía `POST /shopify/connections/install` con `{ "shop_domain": "mitienda.myshopify.com", "account_id": 1 }` y la cuenta existe
- **THEN** el sistema responde `200 OK` con `{ "authorize_url": "https://mitienda.myshopify.com/admin/oauth/authorize?..." }`, y la URL incluye un `state` firmado que codifica el usuario y la cuenta elegida

#### Scenario: Dominio de tienda con formato inválido

- **WHEN** se envía `POST /shopify/connections/install` con `"shop_domain": "mitienda.com"`
- **THEN** el sistema responde `400 Bad Request` y no genera ninguna URL

#### Scenario: Cuenta destino inexistente

- **WHEN** se envía `POST /shopify/connections/install` con un `account_id` que no existe
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Tienda ya conectada por otro usuario

- **WHEN** se envía `POST /shopify/connections/install` con un `shop_domain` que ya tiene una conexión `ACTIVE` de otro usuario
- **THEN** el sistema responde `409 Conflict` y no genera ninguna URL

#### Scenario: Sin el permiso necesario

- **WHEN** un usuario sin `shopify_connection:create` envía `POST /shopify/connections/install`
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Completar la autorización

El sistema SHALL exponer `GET /shopify/oauth/callback`, público frente a la autenticación de paldex — lo invoca Shopify, no un cliente con JWT — que valida la respuesta de Shopify, intercambia el código por un token de acceso, persiste la conexión y redirige al navegador de vuelta al frontend.

El sistema MUST verificar la firma HMAC de los parámetros de query enviados por Shopify y MUST validar que el `state` recibido es el mismo que se emitió, no ha caducado y no se ha usado antes.

#### Scenario: Callback válido completa la conexión

- **WHEN** Shopify redirige a `GET /shopify/oauth/callback` con un `code`, un `shop` y un `state` válidos y no caducados
- **THEN** el sistema intercambia el código por un token de acceso, crea la `ShopifyConnection` en estado `ACTIVE`, registra los webhooks necesarios en la tienda, y redirige el navegador a la URL de retorno del frontend indicando éxito

#### Scenario: Firma HMAC inválida

- **WHEN** llega una petición a `GET /shopify/oauth/callback` cuyos parámetros no verifican contra la firma HMAC esperada
- **THEN** el sistema responde `401 Unauthorized` y no crea ninguna conexión

#### Scenario: State caducado o reutilizado

- **WHEN** llega un callback con un `state` que ya caducó o que ya se usó en un callback anterior
- **THEN** el sistema rechaza la petición y no crea ninguna conexión

#### Scenario: El intercambio de código falla

- **WHEN** Shopify rechaza el intercambio del `code` por un token de acceso
- **THEN** el sistema no crea ninguna conexión y redirige al frontend indicando el fallo, sin exponer el detalle del error de Shopify en la URL

### Requirement: La conexión sólo se completa para tiendas en pesos mexicanos

Al completar el intercambio de código por token, el sistema SHALL consultar la moneda configurada de la tienda y MUST rechazar la conexión si no es pesos mexicanos (MXN).

#### Scenario: Tienda en pesos mexicanos

- **WHEN** se completa la autorización de una tienda cuya moneda configurada es MXN
- **THEN** la conexión se crea con normalidad

#### Scenario: Tienda en otra moneda

- **WHEN** se completa la autorización de una tienda cuya moneda configurada no es MXN
- **THEN** el sistema no crea la conexión, no persiste ningún token, y redirige al frontend indicando el motivo del rechazo

### Requirement: El token de acceso se almacena cifrado

El sistema SHALL cifrar el `access_token` de cada conexión antes de escribirlo en la base de datos, y MUST NOT almacenarlo ni devolverlo en texto plano por ninguna vía de la API.

#### Scenario: El token no sale de la API

- **WHEN** se consulta cualquier endpoint que devuelva una `ShopifyConnection`
- **THEN** la respuesta no contiene el `access_token`, ni en claro ni cifrado

#### Scenario: El token se descifra sólo para llamar a Shopify

- **WHEN** el sistema necesita hacer una petición autenticada a la Admin API de una tienda conectada
- **THEN** descifra el token en memoria para esa llamada y no lo persiste descifrado en ningún sitio

### Requirement: Configurar el mapeo de gateway a cuenta

El sistema SHALL permitir configurar, por conexión, a qué cuenta de paldex se imputan los ingresos de cada gateway de pago, de modo que el efectivo y la tarjeta puedan caer en cuentas distintas y cada una siga cuadrando contra su fuente real.

El sistema SHALL exponer la lectura del mapeo bajo `shopify_connection:read` y su modificación bajo `shopify_connection:update`, ambos en scope `OWN`.

Cada cuenta referida en el mapeo MUST pertenecer al usuario dueño de la conexión. Un gateway MUST aparecer como máximo una vez por conexión.

El sistema SHALL ofrecer los gateways ya vistos en las transacciones sincronizadas de esa conexión, para que el usuario no tenga que adivinar cómo los nombra Shopify.

#### Scenario: Definir el mapeo de un gateway

- **WHEN** el dueño de una conexión mapea el gateway `cash` a una cuenta propia
- **THEN** el mapeo queda guardado y las transacciones posteriores con ese gateway se imputan a esa cuenta

#### Scenario: Cuenta de otro usuario

- **WHEN** se intenta mapear un gateway a una cuenta que no pertenece al dueño de la conexión
- **THEN** el sistema rechaza la operación y el mapeo no se modifica

#### Scenario: Gateway duplicado

- **WHEN** se intenta mapear dos veces el mismo gateway en una conexión
- **THEN** el sistema rechaza la operación

#### Scenario: Cambiar un mapeo no reasigna lo ya sincronizado

- **WHEN** se cambia la cuenta de un gateway que ya generó incomes
- **THEN** los incomes existentes conservan su `account_id` y sólo las transacciones nuevas usan la cuenta nueva

#### Scenario: Sin el permiso de modificación

- **WHEN** un usuario con `shopify_connection:read` pero sin `shopify_connection:update` intenta cambiar el mapeo
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Listar las conexiones propias

El sistema SHALL exponer `GET /shopify/connections`, protegido por `shopify_connection:read` en scope `OWN`, que devuelve las conexiones del usuario autenticado con su `shop_domain`, `account_id`, `status` y `last_synced_at`.

#### Scenario: Listado de conexiones propias

- **WHEN** un usuario con conexiones propias pide `GET /shopify/connections`
- **THEN** el sistema responde `200 OK` con sus conexiones, sin incluir el `access_token` de ninguna

#### Scenario: Un usuario no ve las conexiones de otro

- **WHEN** un usuario sin conexiones pide `GET /shopify/connections` y existen conexiones de otros usuarios
- **THEN** el sistema responde `200 OK` con una lista vacía

### Requirement: Desconectar una tienda

El sistema SHALL exponer `DELETE /shopify/connections/:id`, protegido por `shopify_connection:delete` en scope `OWN`, que revoca el acceso y marca la conexión como `REVOKED`.

El borrado de una conexión MUST NOT eliminar los `Income` que ya se generaron a partir de ella.

#### Scenario: Desconexión correcta

- **WHEN** el propietario de una conexión `ACTIVE` envía `DELETE /shopify/connections/:id`
- **THEN** el sistema responde `200 OK`, la conexión pasa a `REVOKED`, y deja de sincronizar

#### Scenario: Los ingresos ya sincronizados se conservan

- **WHEN** se desconecta una tienda que ya generó ingresos
- **THEN** esos `Income` siguen existiendo y siguen siendo editables por el usuario, sin ningún vínculo activo a Shopify

#### Scenario: Desconectar una conexión ajena

- **WHEN** un usuario intenta `DELETE /shopify/connections/:id` sobre una conexión de otro usuario
- **THEN** el sistema responde `404 Not Found`

#### Scenario: La conexión no existe

- **WHEN** se envía `DELETE /shopify/connections/9999` y no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Webhooks de cumplimiento obligatorios

El sistema SHALL exponer los tres endpoints de cumplimiento que Shopify exige para cualquier app con acceso a datos de pedidos: solicitud de datos del cliente, borrado de datos del cliente y borrado de la tienda. Los tres MUST verificar la firma HMAC con la misma exigencia que cualquier otro webhook, y MUST responder `401 Unauthorized` si la firma no verifica.

Dado que el sistema no ingiere ningún dato personal de los clientes de la tienda — sólo campos financieros de las transacciones —, la solicitud y el borrado de datos del cliente MUST responder confirmando que no hay datos que entregar ni borrar.

#### Scenario: Solicitud de datos de un cliente

- **WHEN** llega `POST /shopify/webhooks/customers-data-request` con una firma HMAC válida
- **THEN** el sistema responde `200 OK`, sin adjuntar ningún dato personal porque no se almacena ninguno

#### Scenario: Borrado de datos de un cliente

- **WHEN** llega `POST /shopify/webhooks/customers-redact` con una firma HMAC válida
- **THEN** el sistema responde `200 OK` de inmediato, sin necesidad de borrar nada porque no hay datos personales del cliente almacenados

#### Scenario: Borrado de la tienda

- **WHEN** llega `POST /shopify/webhooks/shop-redact` con una firma HMAC válida para una tienda con una conexión existente
- **THEN** el sistema responde `200 OK` y borra la `ShopifyConnection` y su token, conservando los `Income` ya generados como registro financiero del propio usuario de paldex

#### Scenario: Firma inválida en cualquier webhook de cumplimiento

- **WHEN** llega cualquiera de los tres webhooks de cumplimiento con una firma HMAC que no verifica
- **THEN** el sistema responde `401 Unauthorized`
