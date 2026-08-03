## ADDED Requirements

### Requirement: Tipo y canal del ingreso

`Income` SHALL tener `income_type` (`SHOPIFY_ORDER`, `SHOPIFY_REFUND`, `MANUAL_ADJUSTMENT`, `OTHER`) y `channel` opcional.

`POST /incomes` MUST aceptar ambos como opcionales. `income_type` por defecto MUST ser `OTHER`. La sincronización de Shopify MUST usar `SHOPIFY_ORDER` para ventas y `SHOPIFY_REFUND` para reembolsos.

La captura manual de ingresos MUST NOT restringirse: cualquier `income_type` es aceptable desde la API, y el flujo actual de `POST /incomes` sigue funcionando sin cambios.

#### Scenario: Ingreso manual sin tipo

- **WHEN** se envía `POST /incomes` con el body actual, sin `income_type`
- **THEN** el sistema responde `201 Created` y el ingreso queda con `income_type: OTHER`

#### Scenario: Ajuste administrativo

- **WHEN** se envía `POST /incomes` con `"income_type": "MANUAL_ADJUSTMENT"` y `"concept": "Ajuste de corte de caja"`
- **THEN** el sistema responde `201 Created` con ese tipo

#### Scenario: Tipo inválido

- **WHEN** se envía `"income_type": "VENTA_MOSTRADOR"`
- **THEN** el sistema responde `400 Bad Request` enumerando los tipos válidos

### Requirement: Desglose financiero del ingreso

`Income` SHALL tener los campos opcionales `gross_amount`, `discount_total`, `fee_total`, `shipping_charged`, `shipping_cost`, `net_amount`, `cogs_total` y `profit_gross`.

`amount` SHALL conservar su significado actual: el monto neto cobrado. `POST /incomes` y `PATCH /incomes/:id` MUST aceptar los campos de desglose como opcionales.

`net_amount` MUST calcularse en el servidor cuando se envíe el desglose, y MUST NOT aceptarse del cliente:

```
net_amount = gross_amount - discount_total - fee_total - shipping_cost
```

Cuando no se envía ningún campo de desglose, `gross_amount` y `net_amount` MUST tomar el valor de `amount`.

`cogs_total` y `profit_gross` MUST ser de sólo lectura para el cliente: los mantiene la capacidad `cogs-tracking`.

#### Scenario: Ingreso manual sin desglose

- **WHEN** se envía `POST /incomes` con `{ "amount": 1200, "concept": "Venta evento", "date": "2026-07-12", "invoiced": false, "account_id": 1 }`
- **THEN** el ingreso queda con `gross_amount: 1200`, `net_amount: 1200`, `discount_total: null`, `cogs_total: null` y `profit_gross: null`

#### Scenario: Ingreso con desglose completo

- **WHEN** se envía un ingreso con `"gross_amount": 1200`, `"discount_total": 100`, `"fee_total": 40`, `"shipping_charged": 90`, `"shipping_cost": 120`
- **THEN** el ingreso queda con `net_amount: 940`

#### Scenario: net_amount enviado por el cliente

- **WHEN** se envía `POST /incomes` con un body válido más `"net_amount": 1`
- **THEN** el sistema responde `400 Bad Request` por campo no reconocido

#### Scenario: profit_gross enviado por el cliente

- **WHEN** se envía `POST /incomes` con un body válido más `"profit_gross": 500`
- **THEN** el sistema responde `400 Bad Request` por campo no reconocido

#### Scenario: Montos negativos en el desglose

- **WHEN** se envía `"discount_total": -50`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Filtros nuevos en el listado de incomes

`GET /incomes` SHALL aceptar, además de los filtros existentes, los parámetros `income_type`, `channel` y `has_cogs` (booleano).

`sort_by` MUST aceptar además `net_amount` y `profit_gross`.

Un valor no permitido MUST responder `400 Bad Request`.

#### Scenario: Filtrar ventas de Shopify

- **WHEN** se pide `GET /incomes?income_type=SHOPIFY_ORDER`
- **THEN** la respuesta contiene sólo ingresos de ese tipo

#### Scenario: Filtrar ventas sin costo capturado

- **WHEN** se pide `GET /incomes?has_cogs=false&start_date=2026-07-01&end_date=2026-07-31`
- **THEN** la respuesta contiene sólo los ingresos de julio con `cogs_total` nulo

#### Scenario: Ordenar por utilidad

- **WHEN** se pide `GET /incomes?sort_by=profit_gross&order=desc`
- **THEN** la respuesta viene ordenada por utilidad bruta descendente

#### Scenario: Valor no permitido

- **WHEN** se pide `GET /incomes?income_type=OTRO_CANAL`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Migración de los ingresos existentes

La migración de este change SHALL asignar a todo ingreso existente:

- `income_type = SHOPIFY_ORDER` si su `source` indica Shopify, `OTHER` en cualquier otro caso.
- `gross_amount = amount` y `net_amount = amount`.
- `discount_total`, `fee_total`, `shipping_charged`, `shipping_cost`, `cogs_total` y `profit_gross` en `null`.
- `channel = 'SHOPIFY'` si su `source` indica Shopify, `null` en cualquier otro caso.

Ningún ingreso existente MUST cambiar de `amount`, `concept`, `date`, `account_id`, `user_id`, `source`, `external_transaction_id` ni de sus taxes asociados.

#### Scenario: Ingreso histórico de Shopify

- **WHEN** se migra un ingreso existente con `source` de Shopify y `amount: 1200`
- **THEN** queda con `income_type: SHOPIFY_ORDER`, `channel: 'SHOPIFY'`, `gross_amount: 1200`, `net_amount: 1200` y `cogs_total: null`

#### Scenario: Ingreso histórico manual

- **WHEN** se migra un ingreso existente sin `source`
- **THEN** queda con `income_type: OTHER`, `channel: null` y su desglose derivado de `amount`
