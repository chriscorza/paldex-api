## ADDED Requirements

### Requirement: Toda fórmula financiera vive en el backend

Los endpoints de reportes SHALL devolver cifras ya calculadas. El cliente MUST NOT necesitar sumar, restar, ni calcular márgenes o porcentajes para presentar un reporte.

Ningún endpoint de reportes MUST exponer sólo datos crudos delegando el cálculo al consumidor.

#### Scenario: El reporte trae los renglones resueltos

- **WHEN** se pide el estado mensual de un periodo
- **THEN** la respuesta contiene cada renglón del estado de resultados como un número, incluyendo los márgenes, sin requerir ninguna operación del cliente

### Requirement: Estado mensual real

El sistema SHALL exponer `GET /reports/monthly?year&month` y, alternativamente, `GET /reports/monthly?start_date&end_date` para un rango personalizado. Exactamente una de las dos formas MUST usarse por petición.

La respuesta SHALL encadenar el estado de resultados en este orden, con estos nombres:

```
gross_sales            ingresos brutos del periodo
discounts              descuentos aplicados
fees                   comisiones de pago y plataforma
refunds                devoluciones
net_sales              = gross_sales - discounts - fees - refunds
cogs                   costo de mercancía vendida confirmado
gross_profit           = net_sales - cogs
operating_expenses     gastos con affects_operating_profit y estado PAID
payroll_total          nómina pagada + gastos de tipo PAYROLL pagados
operating_profit       = gross_profit - operating_expenses - payroll_total
taxes_paid             pagos de impuestos con paid_at en el periodo
net_profit             = operating_profit - taxes_paid
gross_margin_percentage
net_margin_percentage
```

Además MUST incluir, sin mezclarlos con los renglones anteriores: `inventory_purchases`, `owner_withdrawals`, `reinvestment`, `debt_principal_paid`, `sales_without_cost`, `cost_data_coverage`, `gross_profit_purchase_basis`, `iva_estimated`, `isr_estimated`, `invoiced_total`, `not_invoiced_total`.

#### Scenario: Estado mensual completo

- **WHEN** se pide `GET /reports/monthly?year=2026&month=7`
- **THEN** la respuesta contiene todos los renglones anteriores, y cada igualdad de la cadena se cumple exactamente con los valores devueltos

#### Scenario: Mes sin ningún movimiento

- **WHEN** se pide un mes sin ingresos, gastos, nómina ni impuestos
- **THEN** todos los montos son `0`, los porcentajes son `null`, y la respuesta es `200 OK`

#### Scenario: Las dos formas de periodo a la vez

- **WHEN** se pide `GET /reports/monthly?year=2026&month=7&start_date=2026-07-01`
- **THEN** el sistema responde `400 Bad Request` indicando que hay que elegir una sola forma de periodo

#### Scenario: Mes fuera de rango

- **WHEN** se pide `GET /reports/monthly?year=2026&month=13`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Base caja para la utilidad real, base programada para la proyección

La utilidad real SHALL calcularse en base caja:

- Un gasto cuenta si su `status` es `PAID` y su `paid_at` cae en el periodo.
- Un pago de nómina cuenta si su `status` es `PAID` y su `paid_at` cae en el periodo.
- Un pago de impuestos cuenta si su `paid_at` cae en el periodo.
- Un ingreso cuenta por su `date`.

Junto a la utilidad real, la respuesta SHALL incluir un bloque `projection` con lo pendiente del periodo, medido por fecha programada:

```
pending_expenses
pending_payroll
pending_taxes
projected_net_profit   = net_profit - pending_expenses - pending_payroll - pending_taxes
```

#### Scenario: Gasto pendiente no reduce la utilidad real

- **WHEN** el periodo tiene un gasto de `8000` en estado `PENDING` con fecha de vencimiento dentro del mes
- **THEN** `operating_expenses` no lo incluye, `projection.pending_expenses` es `8000`, y `projection.projected_net_profit` es `8000` menor que `net_profit`

#### Scenario: Gasto de un mes pagado en el siguiente

- **WHEN** un gasto con `date` del 28 de julio se paga el 3 de agosto
- **THEN** el reporte de julio no lo cuenta en `operating_expenses`, y el de agosto sí

### Requirement: Desglose de gastos por tipo y por categoría

El sistema SHALL exponer `GET /reports/monthly/expenses-breakdown`, que devuelve, para el periodo pedido:

- `by_type`: un renglón por tipo financiero con su total.
- `by_category`: un renglón por categoría con su total, su tipo, y el número de gastos.

Cada renglón MUST incluir `previous_period_amount`, `variation_amount`, `variation_percentage`, `percentage_of_net_sales` y `percentage_of_gross_profit`.

Cuando el denominador de un porcentaje es cero, el campo MUST ser `null`.

#### Scenario: Desglose con comparación

- **WHEN** el periodo tiene `20000` de nómina y el periodo anterior tuvo `18000`, sobre ventas netas de `100000`
- **THEN** el renglón de tipo `PAYROLL` devuelve `amount: 20000`, `previous_period_amount: 18000`, `variation_amount: 2000`, `variation_percentage: 11.11` y `percentage_of_net_sales: 20`

#### Scenario: Categoría nueva sin histórico

- **WHEN** una categoría tiene gastos en el periodo y ninguno en el anterior
- **THEN** su renglón devuelve `previous_period_amount: 0` y `variation_percentage: null`

#### Scenario: Los retiros del dueño se muestran aparte

- **WHEN** el periodo incluye `500` en una categoría de tipo `OWNER`
- **THEN** el renglón aparece en `by_type` y `by_category`, y el estado mensual lo cuenta en `owner_withdrawals`, no en `operating_expenses`

### Requirement: Reporte fiscal mensual

El sistema SHALL exponer `GET /reports/monthly/fiscal`, que devuelve para el periodo:

```
total_expenses_paid
invoiced_expenses
not_invoiced_expenses
pending_invoice_expenses
not_deductible_expenses
iva_creditable_estimated
iva_not_creditable_missing_invoice
iva_charged
iva_estimated
iva_in_favor
isr_estimated
```

La suma de `invoiced_expenses`, `not_invoiced_expenses`, `pending_invoice_expenses` y `not_deductible_expenses` MUST igualar `total_expenses_paid`.

#### Scenario: Reparto exhaustivo por estado de factura

- **WHEN** el periodo tiene gastos pagados por `50000`, de los cuales `38000` facturados, `5000` no facturados, `6000` pendientes de factura y `1000` no deducibles
- **THEN** el reporte devuelve esos cuatro montos y `total_expenses_paid: 50000`

#### Scenario: Alerta de gastos pendientes de factura

- **WHEN** el periodo tiene `6000` en estado `PENDING_INVOICE`
- **THEN** la respuesta incluye `pending_invoice_expenses: 6000`, disponible para mostrar la alerta correspondiente

### Requirement: Reporte de nómina

El sistema SHALL exponer `GET /reports/monthly/payroll`, que devuelve para el periodo:

```
base_salary_paid
bonuses_paid
deductions
payroll_total          = base_salary_paid + bonuses_paid - deductions
pending_payroll
payroll_ratio          = payroll_total / net_sales × 100
by_employee[]          nombre, pagado, pendiente, base, bonos, número de pagos
deferred_payments[]     pagos de periodos anteriores cobrados en este
```

#### Scenario: Nómina separada entre base y bonos

- **WHEN** el periodo tuvo `18000` de salario base pagado y `2000` de bonos pagados, sobre ventas netas de `100000`
- **THEN** la respuesta devuelve `base_salary_paid: 18000`, `bonuses_paid: 2000`, `payroll_total: 20000` y `payroll_ratio: 20`

#### Scenario: Ratio sin ventas

- **WHEN** el periodo tuvo nómina pagada y cero ventas netas
- **THEN** `payroll_ratio` es `null` y `payroll_total` se reporta normalmente

#### Scenario: Pago diferido señalado

- **WHEN** un pago programado para el 31 de julio se pagó el 3 de agosto
- **THEN** el reporte de agosto lo incluye en `deferred_payments` indicando su `scheduled_pay_date` de julio

### Requirement: Reporte de caja y dinero disponible

El sistema SHALL exponer `GET /reports/cash`, que devuelve por cada cuenta activa:

```
computed_balance   = initial_balance + ingresos - gastos pagados - nómina pagada - impuestos pagados
stored_balance     el valor capturado a mano en Account.balance
drift              = stored_balance - computed_balance
```

Y a nivel global:

```
total_computed_balance
pending_payroll
pending_taxes
available_cash     = total_computed_balance - pending_payroll - pending_taxes
excluded_liabilities  lista de conceptos aún no modelados que no se restan
```

Sólo las cuentas con `is_active: true` MUST sumar al total. `excluded_liabilities` MUST incluir explícitamente `"accounts_payable"` mientras las cuentas por pagar no existan en el modelo, para que el consumidor sepa que la cifra es incompleta por diseño.

#### Scenario: Saldo calculado desde movimientos

- **WHEN** una cuenta tiene `initial_balance: 10000`, ingresos por `50000`, gastos pagados por `20000` y nómina pagada por `8000`
- **THEN** `computed_balance` es `32000`

#### Scenario: Deriva contra el saldo capturado a mano

- **WHEN** esa misma cuenta tiene `Account.balance` en `31500`
- **THEN** la respuesta devuelve `stored_balance: 31500`, `computed_balance: 32000` y `drift: -500`

#### Scenario: Cuenta inactiva excluida

- **WHEN** existe una cuenta con `is_active: false` y saldo positivo
- **THEN** su saldo no suma a `total_computed_balance`, y la cuenta aparece en la respuesta marcada como inactiva

#### Scenario: El dinero disponible declara lo que no resta

- **WHEN** se pide `GET /reports/cash`
- **THEN** `excluded_liabilities` incluye `"accounts_payable"`, señalando que las cuentas por pagar no están descontadas

### Requirement: Los reportes son dinámicos, no snapshots

Los endpoints de reportes SHALL recalcular sus cifras en cada petición a partir de los datos vigentes. El sistema MUST NOT almacenar ni cachear resultados de reportes en este change.

Modificar un gasto de un mes pasado MUST reflejarse inmediatamente en el reporte de ese mes.

#### Scenario: Corrección retroactiva

- **WHEN** se corrige el monto de un gasto de junio y se vuelve a pedir el reporte de junio
- **THEN** el reporte refleja el monto corregido, sin necesidad de recalcular ni invalidar nada

### Requirement: Reportes bajo permiso de lectura

Todos los endpoints bajo `/reports` SHALL exigir JWT válido y el permiso `report:read`.

Bajo alcance `OWN`, los reportes MUST considerar únicamente los datos del usuario autenticado.

#### Scenario: Petición sin permiso

- **WHEN** un usuario con JWT válido pero sin `report:read` pide `GET /reports/monthly?year=2026&month=7`
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Alcance propio

- **WHEN** un usuario con `report:read` en alcance `OWN` pide el estado mensual y existen datos de otros usuarios en el mismo periodo
- **THEN** las cifras devueltas consideran únicamente sus propios ingresos, gastos, nómina e impuestos

### Requirement: El motor de cálculo es puro y testeable sin base de datos

La lógica que encadena los renglones del estado de resultados SHALL vivir en una unidad que reciba los agregados como entrada y devuelva el reporte como salida, sin acceso a Prisma.

Esa unidad MUST tener pruebas unitarias que cubran, como mínimo: un mes completo con todos los renglones, un mes vacío, un mes con cobertura parcial de costo, un mes con utilidad negativa, y un mes con pagos diferidos.

#### Scenario: Cálculo probado sin base de datos

- **WHEN** se ejecutan las pruebas unitarias del motor de cálculo
- **THEN** pasan sin ninguna conexión a base de datos ni mock de Prisma

#### Scenario: Utilidad negativa

- **WHEN** los agregados dan ventas netas `10000`, COGS `8000`, gastos operativos `9000` y nómina `5000`
- **THEN** `operating_profit` es `-12000`, `net_profit` refleja los impuestos pagados sobre esa base, y los márgenes se devuelven negativos sin error
