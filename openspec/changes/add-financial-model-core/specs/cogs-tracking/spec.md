## ADDED Requirements

### Requirement: Registrar el costo de mercancía vendida contra un ingreso

El sistema SHALL permitir registrar una o más filas de costo de mercancía vendida ligadas a un `Income` concreto, mediante `POST /incomes/:id/cogs`.

Cada fila SHALL tener `quantity`, `unit_cost`, `product_reference` opcional, `source` (`MANUAL`, `SHOPIFY`, `INVENTORY`) y `notes` opcional. `total_cost` MUST calcularse como `quantity × unit_cost` en el servidor y MUST NOT aceptarse del cliente.

#### Scenario: Registrar costo manual

- **WHEN** se envía `POST /incomes/12/cogs` con `{ "quantity": 2, "unit_cost": 900, "product_reference": "ETB-SV8", "source": "MANUAL" }`
- **THEN** el sistema responde `201 Created` con la fila creada y `total_cost: 1800`

#### Scenario: total_cost enviado por el cliente

- **WHEN** se envía `POST /incomes/12/cogs` con un body válido más `"total_cost": 1`
- **THEN** el sistema responde `400 Bad Request` por campo no reconocido, y no crea nada

#### Scenario: Cantidad o costo no positivos

- **WHEN** se envía `POST /incomes/12/cogs` con `"quantity": 0` o `"unit_cost": -5`
- **THEN** el sistema responde `400 Bad Request` y no crea nada

#### Scenario: El ingreso no existe o no es del usuario

- **WHEN** se envía `POST /incomes/9999/cogs` y ese ingreso no existe o pertenece a otro usuario bajo alcance `OWN`
- **THEN** el sistema responde `404 Not Found` y no crea nada

### Requirement: El costo agregado se refleja en el ingreso

Al crear, actualizar o borrar filas de costo, el sistema SHALL recalcular en el `Income` afectado:

```
cogs_total   = suma de total_cost de sus filas de costo
profit_gross = net_amount - cogs_total
```

El recálculo MUST ocurrir en la misma transacción que la escritura de la fila de costo.

#### Scenario: Agregar una segunda fila de costo

- **WHEN** un ingreso con `net_amount = 3000` y una fila de costo de `1800` recibe una segunda fila de `400`
- **THEN** el ingreso queda con `cogs_total = 2200` y `profit_gross = 800`

#### Scenario: Borrar la única fila de costo

- **WHEN** se borra la última fila de costo de un ingreso con `net_amount = 3000`
- **THEN** el ingreso queda con `cogs_total = null` y `profit_gross = null`, y vuelve a contarse como venta sin costo capturado

#### Scenario: Cambia el neto del ingreso

- **WHEN** se actualiza `net_amount` de un ingreso que ya tiene costo capturado
- **THEN** `profit_gross` se recalcula con el nuevo neto

### Requirement: El costo faltante nunca se trata como cero

Un ingreso sin ninguna fila de costo SHALL tener `cogs_total = null`, no `0`.

El motor de reportes MUST clasificar ese ingreso como **venta sin costo capturado** y MUST NOT contarlo como si su costo fuera cero.

#### Scenario: Utilidad bruta con cobertura parcial

- **WHEN** un periodo tiene ventas netas de `100000`, de las cuales `60000` tienen costo capturado por `40000`
- **THEN** el reporte devuelve `cogs = 40000`, `gross_profit_confirmed = 20000`, `sales_without_cost = 40000` y `cost_data_coverage = 60`

#### Scenario: Ningún costo capturado

- **WHEN** un periodo tiene ventas y ninguna fila de costo
- **THEN** el reporte devuelve `cogs = 0`, `cost_data_coverage = 0` y la bandera `incomplete_cost_data: true`, sin presentar la utilidad bruta como confiable

### Requirement: El COGS del estado de resultados no se mezcla con la compra de inventario

El renglón COGS del estado de resultados SHALL calcularse **exclusivamente** desde las filas de `CostOfGoodsSold` casadas contra ventas del periodo.

Un `Expense` de categoría de tipo `COGS` representa una **compra de inventario**: MUST reducir la caja del periodo en que se paga, MUST aparecer en el reporte bajo su propio renglón `inventory_purchases`, y MUST NOT restarse de la utilidad bruta ni de la operativa.

El reporte MUST exponer ambos renglones con nombres distintos y MUST NOT presentar una cifra que los sume.

#### Scenario: Compra de inventario y venta en el mismo mes

- **WHEN** en un mes se paga una compra de mercancía de `50000` y se venden productos por `30000` netos con `20000` de costo capturado
- **THEN** el reporte devuelve `cogs = 20000`, `gross_profit_confirmed = 10000` e `inventory_purchases = 50000`, y la caja del mes baja `50000` por esa compra

#### Scenario: La compra de inventario no infla el gasto operativo

- **WHEN** el mismo mes tiene además `8000` de gastos de tipo `OPERATING` pagados
- **THEN** `operating_expenses` es `8000` y no incluye los `50000` de compra de inventario

### Requirement: Utilidad bruta aproximada base compras, claramente etiquetada

Porque la captura de costo por venta puede quedar incompleta, el reporte SHALL exponer además una cifra secundaria:

```
gross_profit_purchase_basis = net_sales - inventory_purchases_paid
```

Esta cifra MUST ir etiquetada como aproximación y MUST NOT usarse para calcular la utilidad operativa ni la neta.

#### Scenario: Aproximación disponible aunque no haya costos capturados

- **WHEN** un periodo tiene ventas netas `100000`, cero costos capturados y compras de inventario pagadas por `70000`
- **THEN** el reporte devuelve `gross_profit_confirmed = null`, `gross_profit_purchase_basis = 30000`, y `operating_profit` se calcula sin usar la aproximación

### Requirement: Consultar y administrar las filas de costo

El sistema SHALL exponer `GET /incomes/:id/cogs`, `PATCH /cogs/:id` y `DELETE /cogs/:id`, protegidos por `cogs:read`, `cogs:update` y `cogs:delete`.

`GET /reports/sales-without-cost` MUST listar los ingresos del periodo sin costo capturado, para que se puedan completar.

#### Scenario: Listar ventas sin costo

- **WHEN** se pide `GET /reports/sales-without-cost?start_date=2026-07-01&end_date=2026-07-31`
- **THEN** la respuesta lista los ingresos del periodo con `cogs_total = null`, su monto neto y el total pendiente de costear

#### Scenario: Petición sin permiso

- **WHEN** un usuario sin `cogs:create` envía `POST /incomes/12/cogs`
- **THEN** el sistema responde `403 Forbidden`
