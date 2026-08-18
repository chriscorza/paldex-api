# Inventory Valuation

## Purpose

Traer de Shopify cuántas piezas hay en existencia, guardarlas como fotos fechadas, y valuar esa mercancía al costo unitario vigente para saber cuánto dinero tiene parado el negocio en inventario.

## ADDED Requirements

### Requirement: Captura de existencias desde Shopify

El sistema SHALL poder consultar las existencias de una conexión de Shopify activa y guardarlas como una foto fechada (`InventorySnapshot`) con un renglón (`InventorySnapshotItem`) por variante y sucursal.

Cada renglón SHALL guardar el identificador de la variante, el del *inventory item*, el SKU, el nombre del producto, la sucursal y las piezas en existencia. Las piezas se toman de la cantidad `on_hand` de Shopify, MUST NOT tomarse de `available`: `available` ya descuenta lo comprometido por pedidos sin surtir, y esa mercancía sigue siendo propiedad del negocio hasta que sale de la tienda.

La foto SHALL registrar el momento en que se tomó (`taken_at`) y a qué conexión y dueño pertenece.

#### Scenario: Captura exitosa

- **WHEN** se toma una foto de una conexión activa cuyo catálogo tiene variantes con existencias en una sucursal
- **THEN** el sistema crea un `InventorySnapshot` con `taken_at` en el momento de la captura y un renglón por cada par variante/sucursal, con las piezas `on_hand` de cada uno

#### Scenario: Producto en varias sucursales

- **WHEN** una variante tiene existencias en dos sucursales
- **THEN** el sistema guarda un renglón por sucursal, cada uno con el nombre de la suya, y el avalúo del producto suma las dos

#### Scenario: Catálogo que no cabe en una página

- **WHEN** la tienda tiene más variantes de las que devuelve una sola página de la API
- **THEN** el sistema pagina hasta agotar el catálogo y la foto incluye todas las variantes, no sólo la primera página

### Requirement: Variantes sin rastreo de inventario

Una variante cuyo `inventoryItem.tracked` sea falso SHALL registrarse con existencia **desconocida**, distinguible de una existencia de cero. El sistema MUST NOT contar sus piezas como cero ni sumarlas al avalúo, y SHALL reportar cuántas variantes quedaron en ese estado.

#### Scenario: Variante sin rastreo

- **WHEN** se captura una variante con `tracked: false`
- **THEN** su renglón queda marcado como existencia desconocida, no aporta al total valuado, y el conteo de variantes sin rastreo del snapshot lo incluye

### Requirement: Existencias negativas

El sistema SHALL conservar tal cual una existencia negativa devuelta por Shopify —lo que ocurre cuando se vendió más de lo que había registrado— y valuarla como valor negativo. MUST NOT redondearse a cero: hacerlo escondería un descuadre real de inventario.

#### Scenario: Sobreventa

- **WHEN** Shopify devuelve `on_hand: -3` para una variante con costo de 100
- **THEN** el renglón guarda `-3` piezas y un costo total de `-300`, y ese valor se refleja en el total del avalúo

### Requirement: Scope de inventario obligatorio

Antes de consultar existencias el sistema SHALL comprobar que la conexión tenga concedido el scope `read_inventory`. Si no lo tiene, SHALL fallar con un error explícito que diga que la conexión debe reinstalarse, y MUST NOT intentar la consulta a Shopify.

#### Scenario: Conexión instalada sin el scope

- **WHEN** se pide una foto de una conexión cuyo scope concedido no incluye `read_inventory`
- **THEN** el sistema responde con un error que identifica la conexión y pide reinstalarla, sin llamar a la API de Shopify

### Requirement: Costo unitario del avalúo

Cada renglón del avalúo SHALL valuarse con el primer costo disponible en este orden: `ProductCost` del dueño por `shopify_variant_id`, luego `ProductCost` del dueño por `sku`, y por último el `inventoryItem.unitCost` que traiga Shopify. De `ProductCost` SHALL usarse el renglón vigente más reciente, ignorando los que tengan `effective_from` posterior a la fecha de la foto.

Este orden MUST coincidir con el que usa el costeo de las ventas, salvo por el costo congelado en la venta, que no aplica a mercancía sin vender.

Cada renglón SHALL publicar de dónde salió su costo. Un renglón sin ningún costo disponible SHALL quedar con costo unitario y costo total nulos, y MUST NOT contarse como cero en el total.

#### Scenario: Costo manual gana sobre el de Shopify

- **WHEN** una variante tiene un `ProductCost` de 90 por variante y Shopify reporta `unitCost` de 75
- **THEN** el avalúo usa 90 y el renglón indica que el costo vino del catálogo por variante

#### Scenario: Sin costo en el catálogo

- **WHEN** una variante no tiene `ProductCost` ni por variante ni por SKU, pero Shopify reporta `unitCost` de 75
- **THEN** el avalúo usa 75 y el renglón indica que el costo vino de Shopify

#### Scenario: Sin costo en ninguna parte

- **WHEN** una variante no tiene `ProductCost` y Shopify no reporta `unitCost`
- **THEN** el renglón queda con costo unitario y costo total nulos, cuenta entre los productos sin costo, y sus piezas no suman al total valuado

#### Scenario: Costo con fecha futura

- **WHEN** existe un `ProductCost` cuyo `effective_from` es posterior a `taken_at` de la foto
- **THEN** el avalúo ignora ese costo y usa el vigente a la fecha de la foto

### Requirement: Cobertura del avalúo

El avalúo SHALL publicar qué porcentaje de las piezas con existencia conocida quedó valuado. Cuando la cobertura sea menor al 100 %, el total SHALL interpretarse como un piso: hay mercancía cuyo costo el sistema no conoce.

#### Scenario: Cobertura parcial

- **WHEN** el avalúo cubre 80 piezas con costo y 20 sin costo
- **THEN** la cobertura reportada es 80 % y el total sólo suma las 80 piezas valuadas

#### Scenario: Sin existencias

- **WHEN** la foto no tiene ninguna pieza en existencia
- **THEN** la cobertura se reporta como nula, no como cero por ciento

### Requirement: Reporte de avalúo de inventario

El sistema SHALL exponer `GET /reports/inventory-valuation`, que devuelve el avalúo de una foto: un renglón por producto con SKU, nombre, piezas en existencia, costo unitario y costo total, ordenados de mayor a menor costo total, más los totales del avalúo.

Sin parámetros SHALL usar la foto más reciente del dueño. Si el dueño tiene varias conexiones de Shopify, SHALL usar la más reciente **de cada una** y sumarlas: quedarse sólo con la última dejaría fuera el inventario de la otra tienda sin decirlo. SHALL aceptar elegir otra foto por identificador o por fecha, en cuyo caso usa la más reciente tomada en o antes de esa fecha. Si el dueño no tiene ninguna foto, SHALL responder que no hay avalúo disponible y decir cómo tomar la primera, en vez de devolver un reporte en ceros que parecería un inventario vacío.

Los totales SHALL calcularse siempre sobre el avalúo completo, nunca sobre la página devuelta.

#### Scenario: Avalúo de la foto más reciente

- **WHEN** se pide el reporte sin parámetros y el dueño tiene fotos de varias fechas
- **THEN** el sistema responde con el avalúo de la más reciente, indicando de qué foto y de qué fecha se trata

#### Scenario: Orden por costo total

- **WHEN** el avalúo tiene un producto de 10 200 y otro de 6 000 de costo total
- **THEN** el de 10 200 aparece primero

#### Scenario: Dueño con dos tiendas

- **WHEN** se pide el reporte sin parámetros y el dueño tiene dos conexiones, cada una con fotos de varias fechas
- **THEN** el avalúo suma la foto más reciente de cada conexión, e identifica las dos que usó

#### Scenario: Avalúo a una fecha pasada

- **WHEN** se pide el reporte con una fecha para la que existe una foto anterior
- **THEN** el sistema responde con el avalúo de la foto más reciente tomada en o antes de esa fecha

#### Scenario: Dueño sin ninguna foto

- **WHEN** se pide el reporte y el dueño nunca ha tomado una foto
- **THEN** el sistema responde indicando que no hay avalúo disponible, y no devuelve totales en cero

#### Scenario: Totales independientes de la paginación

- **WHEN** se pide una página del avalúo que sólo contiene parte de los productos
- **THEN** los totales devueltos siguen siendo los del avalúo completo

### Requirement: Toma de foto a demanda

El sistema SHALL exponer `POST /inventory/snapshots`, que toma una foto de las conexiones activas del dueño y devuelve la foto creada con sus totales.

Una captura que falle a medias MUST NOT dejar una foto parcial disponible para el avalúo: la foto SHALL quedar disponible sólo cuando la captura termine completa.

#### Scenario: Captura a demanda

- **WHEN** el dueño llama al endpoint teniendo una conexión activa
- **THEN** el sistema consulta Shopify, guarda la foto y responde con su identificador, su fecha y sus totales

#### Scenario: Falla a media captura

- **WHEN** la consulta a Shopify falla después de guardar parte de los renglones
- **THEN** la foto no queda disponible como avalúo y el error se reporta a quien la pidió

#### Scenario: Dueño sin conexión de Shopify

- **WHEN** el dueño no tiene ninguna conexión activa
- **THEN** el sistema responde con un error que lo dice, y no crea ninguna foto

### Requirement: Histórico de fotos

El sistema SHALL exponer `GET /inventory/snapshots`, que lista las fotos del dueño de la más reciente a la más antigua, cada una con su fecha, sus totales de piezas y de costo, y cuántos productos quedaron sin costo.

Las fotos SHALL conservarse; el sistema MUST NOT sobrescribir una foto anterior al tomar una nueva.

#### Scenario: Listado del histórico

- **WHEN** el dueño ha tomado tres fotos en fechas distintas y consulta el listado
- **THEN** el sistema devuelve las tres, de la más reciente a la más antigua, cada una con sus totales

#### Scenario: Foto nueva no pisa a la anterior

- **WHEN** se toma una foto nueva existiendo ya una de ayer
- **THEN** las dos quedan en el histórico y el avalúo de la de ayer sigue dando el mismo resultado que antes

### Requirement: Captura diaria automática

El sistema SHALL tomar una foto al día por cada dueño con al menos una conexión activa, ejecutada por dueño y no de forma global, en la zona horaria del negocio.

La captura automática SHALL respetar el interruptor general de trabajos programados. Un fallo al capturar el inventario de un dueño MUST NOT impedir la captura de los demás.

#### Scenario: Corrida diaria

- **WHEN** corre el trabajo programado y hay dos dueños con conexión activa
- **THEN** el sistema toma una foto para cada uno, atribuida a su propio dueño

#### Scenario: Un dueño falla

- **WHEN** la captura de un dueño falla porque su conexión perdió el token
- **THEN** el sistema registra el fallo y continúa con los demás dueños

#### Scenario: Trabajos programados apagados

- **WHEN** los trabajos programados están deshabilitados por configuración
- **THEN** la captura diaria no se ejecuta

### Requirement: Permisos y propiedad de los datos

Las lecturas de inventario SHALL exigir el permiso `inventory:read` y la captura a demanda el permiso `inventory:sync`, ambos con variante de alcance propio.

Un usuario con alcance propio SHALL ver únicamente las fotos de sus propias conexiones y valuarlas con sus propios `ProductCost`. MUST NOT poder leer ni disparar la captura de las conexiones de otro dueño.

#### Scenario: Lectura sin permiso

- **WHEN** un usuario sin `inventory:read` consulta el avalúo
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Alcance propio

- **WHEN** un usuario con alcance propio consulta el histórico y existen fotos de otro dueño
- **THEN** el sistema devuelve sólo las suyas
