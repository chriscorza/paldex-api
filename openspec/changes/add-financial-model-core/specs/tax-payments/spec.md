## ADDED Requirements

### Requirement: Registrar un pago de impuestos con periodo fiscal separado de la fecha de pago

El sistema SHALL exponer `POST /tax-payments`, que crea un pago de impuestos con `type` (`IVA`, `ISR`, `PAYROLL_TAX`, `OTHER`), `fiscal_period_start`, `fiscal_period_end`, `amount`, `account_id`, y opcionalmente `due_date`, `paid_at`, `tax_id` y `notes`.

`fiscal_period_start` MUST ser anterior o igual a `fiscal_period_end`.

El estado inicial SHALL ser `PENDING` si no se envía `paid_at`, y `PAID` si se envía.

#### Scenario: IVA de julio pagado en agosto

- **WHEN** se envía `POST /tax-payments` con `{ "type": "IVA", "fiscal_period_start": "2026-07-01", "fiscal_period_end": "2026-07-31", "amount": 12400, "account_id": 2, "paid_at": "2026-08-17" }`
- **THEN** el sistema responde `201 Created` con el pago en estado `PAID`

#### Scenario: Obligación registrada antes de pagarse

- **WHEN** se envía el mismo body sin `paid_at`, con `"due_date": "2026-08-17"`
- **THEN** el sistema responde `201 Created` con el pago en estado `PENDING`

#### Scenario: Periodo fiscal invertido

- **WHEN** se envía `"fiscal_period_start": "2026-07-31"` y `"fiscal_period_end": "2026-07-01"`
- **THEN** el sistema responde `400 Bad Request` y no crea nada

#### Scenario: Cuenta inexistente

- **WHEN** se envía `"account_id": 9999` y esa cuenta no existe o no es del usuario
- **THEN** el sistema responde `400 Bad Request` y no crea nada

### Requirement: Dos fechas, dos verdades

Un pago de impuestos SHALL contarse:

- **En la caja** del mes de su `paid_at`.
- **Como obligación fiscal** del periodo indicado por `fiscal_period_start`/`fiscal_period_end`, aunque se pague después.

El reporte mensual MUST exponer ambas lecturas como campos distintos y MUST NOT presentarlas como una sola cifra.

#### Scenario: El mismo pago en dos reportes

- **WHEN** el IVA del periodo julio se paga el 17 de agosto por `12400`
- **THEN** el reporte de julio muestra `iva_obligation_period: 12400` con `iva_paid_in_period: 0`, y el reporte de agosto muestra `iva_paid_in_period: 12400` marcado como correspondiente al periodo de julio

#### Scenario: La caja baja en el mes del pago

- **WHEN** se consulta el reporte de caja de agosto
- **THEN** los `12400` aparecen como salida de la cuenta indicada, en agosto

### Requirement: Marcar un pago pendiente como pagado

El sistema SHALL exponer `POST /tax-payments/:id/pay`, que recibe `paid_at`, opcionalmente `account_id` y un `amount` final, y transiciona el pago a `PAID`.

Un pago en estado `PAID` o `CANCELLED` MUST NOT poder pagarse de nuevo.

#### Scenario: Pago de una obligación pendiente

- **WHEN** se envía `POST /tax-payments/4/pay` con `{ "paid_at": "2026-08-17" }` sobre un pago `PENDING`
- **THEN** el pago queda `PAID` y deja de contarse como impuesto pendiente

#### Scenario: Doble pago

- **WHEN** se envía `POST /tax-payments/4/pay` sobre un pago `PAID`
- **THEN** el sistema responde `409 Conflict`

### Requirement: Los pagos de impuestos no se registran también como gasto

`TaxPayment` SHALL ser la única fuente de verdad de los pagos de IVA, ISR y otros impuestos. El sistema MUST NOT crear un `Expense` a partir de un `TaxPayment`, y el motor de reportes SHALL proyectar los pagos de impuestos al renglón `taxes_paid` directamente.

Los gastos de categoría de tipo `TAX` MUST reservarse para conceptos que no son el impuesto en sí —honorarios del contador, multas, trámites— y MUST contarse como gasto operativo, no como impuesto pagado.

#### Scenario: Pago de impuestos no duplica

- **WHEN** se registra un `TaxPayment` de IVA por `12400` pagado en agosto
- **THEN** no aparece ningún `Expense` nuevo, y el reporte de agosto muestra `taxes_paid: 12400` sin alterar `operating_expenses`

#### Scenario: Honorarios del contador

- **WHEN** se registra un gasto pagado de `2500` en la categoría `Contador` (tipo `TAX`)
- **THEN** el reporte lo cuenta en `operating_expenses` y en el desglose del tipo `TAX`, y `taxes_paid` sigue reflejando sólo los `TaxPayment`

### Requirement: Estimación simple de IVA por periodo

El sistema SHALL exponer `GET /tax-payments/estimate?start_date&end_date`, que calcula:

```
iva_charged     = suma del IVA trasladado en ingresos facturados del periodo
iva_creditable  = suma de tax_creditable_amount de los gastos del periodo con invoice_status = INVOICED e is_tax_deductible = true
iva_estimated   = iva_charged - iva_creditable
```

Si `iva_estimated` resulta negativo, la respuesta MUST exponer `iva_in_favor` con su valor absoluto y `iva_estimated: 0`.

Un gasto no facturado MUST NOT aportar a `iva_creditable`, aunque haya reducido la caja.

#### Scenario: IVA por pagar

- **WHEN** el periodo tiene `16000` de IVA trasladado y `9000` de IVA acreditable en gastos facturados y deducibles
- **THEN** la respuesta devuelve `iva_estimated: 7000` y `iva_in_favor: 0`

#### Scenario: IVA a favor

- **WHEN** el periodo tiene `5000` de IVA trasladado y `8000` de IVA acreditable
- **THEN** la respuesta devuelve `iva_estimated: 0` y `iva_in_favor: 3000`

#### Scenario: Gasto real sin factura no acredita

- **WHEN** el periodo incluye un gasto pagado de `1160` con `invoice_status: NOT_INVOICED` cuyo IVA sería `160`
- **THEN** `iva_creditable` no incluye esos `160`, y el reporte fiscal lo expone en `iva_not_creditable_missing_invoice`

### Requirement: Estimación de ISR por porcentaje configurable

El sistema SHALL calcular el ISR estimado del periodo como:

```
isr_estimated = utilidad antes de impuestos × porcentaje configurado
```

El porcentaje SHALL leerse de la variable de entorno `ISR_ESTIMATE_PERCENTAGE`, y SHALL poder sobreescribirse por petición con el parámetro `isr_percentage`. Si no hay porcentaje configurado ni enviado, el sistema MUST devolver `isr_estimated: null` y MUST NOT asumir un valor.

El sistema MUST NOT intentar modelar regímenes fiscales, deducciones personales ni tarifas progresivas.

#### Scenario: ISR estimado con porcentaje configurado

- **WHEN** `ISR_ESTIMATE_PERCENTAGE=30` y la utilidad antes de impuestos del periodo es `40000`
- **THEN** la respuesta devuelve `isr_estimated: 12000` y `isr_percentage_used: 30`

#### Scenario: Sin porcentaje configurado

- **WHEN** no hay `ISR_ESTIMATE_PERCENTAGE` ni parámetro en la petición
- **THEN** la respuesta devuelve `isr_estimated: null` con un aviso de que falta configurar el porcentaje

#### Scenario: Utilidad negativa

- **WHEN** la utilidad antes de impuestos del periodo es `-5000`
- **THEN** la respuesta devuelve `isr_estimated: 0`, no un valor negativo

### Requirement: Listar, editar y cancelar pagos de impuestos

El sistema SHALL exponer `GET /tax-payments`, `GET /tax-payments/:id`, `PATCH /tax-payments/:id` y `DELETE /tax-payments/:id`, protegidos por los permisos `tax_payment:<action>`.

`GET /tax-payments` MUST aceptar los filtros `type`, `status`, y rango de fechas sobre `paid_at` o sobre `fiscal_period_start`, seleccionable con `date_field`.

Un pago en estado `PAID` MUST NOT poder borrarse; MUST poder pasarse a `CANCELLED`.

#### Scenario: Filtrar por periodo fiscal

- **WHEN** se pide `GET /tax-payments?type=IVA&date_field=fiscal_period_start&start_date=2026-07-01&end_date=2026-07-31`
- **THEN** la respuesta contiene los pagos de IVA cuyo periodo fiscal empieza en julio, sin importar cuándo se pagaron

#### Scenario: Borrar un pago pagado

- **WHEN** se envía `DELETE /tax-payments/4` sobre un pago `PAID`
- **THEN** el sistema responde `409 Conflict` sugiriendo la cancelación
