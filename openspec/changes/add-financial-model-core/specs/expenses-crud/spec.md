## ADDED Requirements

### Requirement: Clasificación del gasto por categoría

`POST /expenses` y `PATCH /expenses/:id` SHALL aceptar `category_id` opcional, que MUST referenciar una `ExpenseCategory` existente y accesible por el usuario.

`GET /expenses` y `GET /expenses/:id` SHALL incluir la categoría del gasto —su `id`, `name` y `type`— en la respuesta.

Un gasto sin categoría MUST tratarse en los reportes como de tipo `OTHER`.

#### Scenario: Crear un gasto con categoría

- **WHEN** se envía `POST /expenses` con un body válido más `"category_id": 3` y esa categoría existe
- **THEN** el sistema responde `201 Created` y la respuesta incluye la categoría con su nombre y su tipo

#### Scenario: Categoría inexistente

- **WHEN** se envía `POST /expenses` con `"category_id": 9999` y esa categoría no existe
- **THEN** el sistema responde `400 Bad Request` indicando que la categoría no existe, y no crea nada

#### Scenario: Gasto sin categoría

- **WHEN** se crea un gasto sin `category_id`
- **THEN** el sistema lo acepta, `category` es `null` en la respuesta, y el desglose de reportes lo agrupa bajo el tipo `OTHER`

### Requirement: Estado de pago del gasto

`Expense` SHALL tener `status` (`PENDING`, `PAID`, `SKIPPED`, `CANCELLED`) y `paid_at` opcional.

`POST /expenses` MUST aceptar `status` y `paid_at` opcionales. Si no se envía `status`, el valor por defecto MUST ser `PAID` con `paid_at = date`, para preservar el comportamiento actual de captura de gastos ya desembolsados.

Un gasto en `status: PAID` MUST tener `paid_at`. Un gasto con `paid_at` MUST NOT estar en `status: PENDING`.

El sistema SHALL exponer `POST /expenses/:id/pay`, que recibe `paid_at`, opcionalmente `account_id` y un `amount` final, y transiciona el gasto a `PAID`. Un gasto ya `PAID` o `CANCELLED` MUST responder `409 Conflict`.

Sólo un gasto `PAID` MUST contar en la utilidad real; `PENDING` cuenta en la proyección; `SKIPPED` y `CANCELLED` no cuentan en ninguna.

#### Scenario: Gasto capturado como pagado por defecto

- **WHEN** se envía `POST /expenses` con `{ "amount": 89.9, "concept": "Material oficina", "date": "2026-07-10", "invoiced": true, "account_id": 1 }` sin `status`
- **THEN** el gasto queda en `status: PAID` con `paid_at` igual a su `date`

#### Scenario: Gasto pendiente

- **WHEN** se envía `POST /expenses` con `"status": "PENDING"` y sin `paid_at`
- **THEN** el sistema responde `201 Created` con el gasto pendiente, y el reporte del mes lo cuenta en la proyección, no en la utilidad real

#### Scenario: Estado y fecha incoherentes

- **WHEN** se envía `POST /expenses` con `"status": "PAID"` y sin `paid_at` ni `date` utilizable, o con `"status": "PENDING"` y un `paid_at`
- **THEN** el sistema responde `400 Bad Request` y no crea nada

#### Scenario: Marcar un gasto pendiente como pagado

- **WHEN** se envía `POST /expenses/12/pay` con `{ "paid_at": "2026-08-05", "amount": 740 }` sobre un gasto `PENDING` de `700`
- **THEN** el gasto queda `PAID` con `amount: 740` y `paid_at` en agosto, y cuenta en la utilidad real de agosto

#### Scenario: Doble pago

- **WHEN** se envía `POST /expenses/12/pay` sobre un gasto ya `PAID`
- **THEN** el sistema responde `409 Conflict` y no altera el gasto

### Requirement: Identidad fiscal del gasto

`Expense` SHALL tener los campos fiscales `invoice_status` (`NOT_INVOICED`, `PENDING_INVOICE`, `INVOICED`, `NOT_DEDUCTIBLE`), `invoice_uuid`, `supplier_rfc`, `vendor`, `subtotal`, `tax_amount`, `withholding_amount`, `is_tax_deductible` y `tax_creditable_amount`, todos opcionales salvo `invoice_status` e `is_tax_deductible`.

`POST /expenses` y `PATCH /expenses/:id` MUST aceptarlos. `invoice_status` por defecto MUST derivarse del booleano `invoiced`: `INVOICED` si es `true`, `NOT_INVOICED` si es `false`. `is_tax_deductible` por defecto MUST ser `true` salvo que `invoice_status` sea `NOT_DEDUCTIBLE`.

`tax_creditable_amount` MUST calcularse en el servidor y MUST NOT aceptarse del cliente:

```
tax_creditable_amount = tax_amount   si invoice_status = INVOICED y is_tax_deductible = true
tax_creditable_amount = 0            en cualquier otro caso
```

#### Scenario: Gasto facturado y deducible

- **WHEN** se crea un gasto con `"invoice_status": "INVOICED"`, `"subtotal": 8000`, `"tax_amount": 1280`, `"amount": 9280`, `"is_tax_deductible": true`
- **THEN** el gasto queda con `tax_creditable_amount: 1280` y aporta ese monto al IVA acreditable del periodo

#### Scenario: Gasto real sin factura

- **WHEN** se crea un gasto pagado con `"invoice_status": "NOT_INVOICED"` y `"tax_amount": 160`
- **THEN** el gasto queda con `tax_creditable_amount: 0`, reduce la caja y la utilidad operativa, y no aporta IVA acreditable

#### Scenario: Gasto marcado como no deducible

- **WHEN** se crea un gasto con `"invoice_status": "NOT_DEDUCTIBLE"`
- **THEN** `is_tax_deductible` queda en `false` y `tax_creditable_amount` en `0`

#### Scenario: tax_creditable_amount enviado por el cliente

- **WHEN** se envía `POST /expenses` con un body válido más `"tax_creditable_amount": 5000`
- **THEN** el sistema responde `400 Bad Request` por campo no reconocido

#### Scenario: UUID fiscal con formato inválido

- **WHEN** se envía `"invoice_uuid": "no-es-un-uuid"`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: El booleano invoiced se mantiene sincronizado

El campo `invoiced` SHALL conservarse en el modelo y en las respuestas de la API para no romper a los consumidores existentes, y MUST mantenerse siempre coherente con `invoice_status`:

```
invoiced === (invoice_status === 'INVOICED')
```

Cuando una petición envía ambos campos con valores contradictorios, `invoice_status` MUST prevalecer y `invoiced` MUST ajustarse en consecuencia.

#### Scenario: Sólo se envía invoice_status

- **WHEN** se crea un gasto con `"invoice_status": "INVOICED"` sin enviar `invoiced`
- **THEN** la respuesta contiene `invoiced: true`

#### Scenario: Valores contradictorios

- **WHEN** se crea un gasto con `"invoiced": true` e `"invoice_status": "PENDING_INVOICE"`
- **THEN** el sistema acepta la petición, guarda `invoice_status: PENDING_INVOICE` y devuelve `invoiced: false`

#### Scenario: Cliente antiguo que sólo conoce invoiced

- **WHEN** se crea un gasto con `"invoiced": false` sin enviar `invoice_status`
- **THEN** el gasto queda con `invoice_status: NOT_INVOICED` e `invoiced: false`

### Requirement: Filtros nuevos en el listado de expenses

`GET /expenses` SHALL aceptar, además de los filtros existentes, los parámetros `category_id`, `category_type`, `status`, `invoice_status`, `vendor`, `is_tax_deductible` y `date_field` (`date` o `paid_at`, con `date` por defecto).

Un valor no permitido en cualquiera de estos parámetros MUST responder `400 Bad Request`, coherente con el comportamiento actual de `sort_by`.

`sort_by` MUST aceptar además `paid_at`.

#### Scenario: Filtrar por tipo financiero

- **WHEN** se pide `GET /expenses?category_type=PAYROLL`
- **THEN** la respuesta contiene sólo gastos cuya categoría es de tipo `PAYROLL`

#### Scenario: Filtrar gastos pendientes de factura

- **WHEN** se pide `GET /expenses?invoice_status=PENDING_INVOICE`
- **THEN** la respuesta contiene sólo los gastos en ese estado de factura

#### Scenario: Filtrar por fecha real de pago

- **WHEN** se pide `GET /expenses?date_field=paid_at&start_date=2026-08-01&end_date=2026-08-31`
- **THEN** la respuesta contiene los gastos efectivamente pagados en agosto, sin importar su `date`

#### Scenario: Valor no permitido

- **WHEN** se pide `GET /expenses?status=PAGADO`
- **THEN** el sistema responde `400 Bad Request` enumerando los valores válidos

#### Scenario: Combinación de filtros

- **WHEN** se pide `GET /expenses?category_type=OPERATING&status=PAID&date_field=paid_at&start_date=2026-07-01&end_date=2026-07-31&sort_by=paid_at&order=desc&page=1&limit=10`
- **THEN** todos los filtros se aplican simultáneamente y la respuesta viene paginada y ordenada como se pidió

### Requirement: Migración de los gastos existentes

La migración de este change SHALL asignar a todo gasto existente:

- `status = PAID` y `paid_at = date`.
- `invoice_status = INVOICED` si `invoiced` es `true`, `NOT_INVOICED` si es `false`.
- `is_tax_deductible = true`.
- `category_id = null`.
- `tax_creditable_amount = 0`.

Ningún gasto existente MUST cambiar de `amount`, `concept`, `date`, `account_id`, `user_id` ni de sus taxes asociados.

#### Scenario: Gasto histórico facturado

- **WHEN** se migra un gasto existente con `invoiced: true`
- **THEN** queda con `status: PAID`, `paid_at` igual a su `date`, `invoice_status: INVOICED`, y su `amount` intacto

#### Scenario: Los reportes cuentan el histórico

- **WHEN** se pide el reporte mensual de un mes anterior a este change
- **THEN** los gastos migrados de ese mes cuentan como pagados, agrupados bajo el tipo `OTHER` por no tener categoría
