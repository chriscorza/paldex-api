# Income Statement

## Purpose

Dar al dueño un estado de resultados (P&L) en base de efectivo, por cualquier rango de fechas, que separe la operación de la depreciación, los intereses y los impuestos a la utilidad, para obtener EBITDA, EBIT y utilidad neta, y que muestre aparte el dinero que sale sin ser gasto.

## ADDED Requirements

### Requirement: Rango de fechas explícito

`GET /reports/income-statement` SHALL exigir `start_date` y `end_date`, interpretados en la zona horaria del negocio con el último día incluido, y SHALL exigir `report:read`. Un rango mayor a 366 días o con `end_date` anterior a `start_date` SHALL responder `400`. El sistema MUST NOT suponer un periodo por omisión.

#### Scenario: Falta una fecha

- **WHEN** se llama sin `end_date`
- **THEN** el API responde `400`

#### Scenario: Rango demasiado largo

- **WHEN** el rango cubre 400 días
- **THEN** el API responde `400` y no devuelve un reporte truncado

### Requirement: Estructura del estado de resultados

El reporte SHALL calcular, en este orden:

1. Ventas netas: suma de `Income.net_amount` del rango, con el mismo filtro que `GET /reports/monthly`.
2. Costo de ventas: COGS de `CostOfGoodsSold` más gastos pagados en categorías `SHOPIFY_FEES` y `SHIPPING`.
3. Utilidad bruta = 1 − 2.
4. Gastos de operación: gastos pagados en categorías con `affects_operating_profit` (por categoría), más nómina (neto de `PayrollPayment` pagado más `TaxPayment` `PAYROLL_TAX` pagado), más `TaxPayment` `OTHER` pagado.
5. EBITDA = 3 − 4.
6. Depreciación y amortización de los activos del dueño en el rango.
7. Utilidad operativa (EBIT) = 5 − 6.
8. Intereses (gastos pagados en categorías `INTEREST`) y otros resultados (ganancia o pérdida en baja de activos).
9. Utilidad antes de impuestos = 7 − 8.
10. Impuestos a la utilidad: `TaxPayment` `ISR` pagado.
11. Utilidad neta = 9 − 10.

Cada subtotal SHALL publicar su margen sobre ventas netas con `percentage()`, nulo cuando las ventas netas son cero.

#### Scenario: Cuadre de EBITDA

- **WHEN** en el rango hay ventas netas de 100,000, COGS de 40,000, gastos operativos de 20,000, nómina neta de 15,000, `PAYROLL_TAX` de 3,000, depreciación de 2,000, intereses de 1,000 e ISR de 4,000
- **THEN** la utilidad bruta es 60,000, el EBITDA 22,000, el EBIT 20,000, la utilidad antes de impuestos 19,000 y la utilidad neta 15,000

#### Scenario: Gasto de comisión capturado a mano

- **WHEN** hay un gasto pagado de 500 en una categoría `SHOPIFY_FEES`
- **THEN** aparece en costo de ventas y reduce la utilidad bruta en 500

### Requirement: El IVA no es gasto

Los `TaxPayment` de tipo `IVA` MUST NOT afectar ningún renglón del estado de resultados; SHALL aparecer en el bloque de flujo como "IVA enterado".

#### Scenario: Pago de IVA

- **WHEN** se paga IVA por 8,000 en el rango
- **THEN** la utilidad neta no cambia y `cash_items` muestra 8,000 de IVA enterado

### Requirement: Intereses fuera del EBITDA

Los gastos en categorías de tipo `INTEREST` SHALL restarse después del EBIT y MUST NOT restarse en gastos de operación.

#### Scenario: Pago de intereses

- **WHEN** se pagan 1,000 de intereses de un préstamo
- **THEN** el EBITDA y el EBIT no cambian y la utilidad antes de impuestos baja 1,000

### Requirement: Compras de activos fuera del P&L

Los gastos en categorías de tipo `CAPEX` MUST NOT restarse en ningún renglón del estado de resultados; SHALL aparecer en el bloque de flujo como "Compra de activos". La depreciación de esos activos SHALL ser lo único que los refleje en el P&L.

#### Scenario: Compra de una computadora

- **WHEN** en marzo se paga una computadora de 30,000 con un gasto `CAPEX` y se registra el activo con 40 meses de vida, en uso desde marzo
- **THEN** el estado de resultados de marzo no resta los 30,000, `cash_items` muestra 30,000 de compra de activos, y el de abril resta 750 de depreciación

### Requirement: Bloque de flujo de efectivo

La respuesta SHALL incluir `cash_items` con lo pagado en el rango que no es gasto del P&L: IVA enterado, compra de activos, venta de activos, compras de inventario (`COGS`), pago de capital de deuda (`DEBT`), retiros del dueño y reinversión (`OWNER`). Todo gasto pagado del rango SHALL caer en exactamente un renglón del P&L o de `cash_items`.

#### Scenario: Ningún gasto se pierde

- **WHEN** se suman los gastos pagados del rango por cada renglón del P&L y de `cash_items`
- **THEN** el total es igual a la suma de todos los gastos pagados del rango

### Requirement: Calidad de datos y avisos

La respuesta SHALL incluir `quality.cost_data_coverage` y `quality.incomplete_cost_data`, calculados como en `GET /reports/monthly`. SHALL incluir en `warnings` cada activo cuya fecha de compra caiga en el rango y no tenga `expense_id`, como aviso de un posible doble conteo.

#### Scenario: Costo incompleto

- **WHEN** el 80 % de las ventas del rango tiene costo capturado
- **THEN** `quality.cost_data_coverage` es 80 e `incomplete_cost_data` es verdadero

#### Scenario: Activo sin gasto vinculado

- **WHEN** un activo comprado dentro del rango no tiene `expense_id`
- **THEN** `warnings` lo nombra y sugiere revisar en qué categoría quedó su compra

### Requirement: Renglones listos para pintar y exportar

La respuesta SHALL incluir `lines`, una lista ordenada de renglones `{ key, label, amount, level, children? }` con el desglose por categoría dentro de costo de ventas, gastos de operación y nómina, y un bloque `summary` con `net_sales`, `gross_profit`, `ebitda`, `ebit`, `pre_tax_income` y `net_income` y sus márgenes. `GET /reports/income-statement/export?format=csv` SHALL producir exactamente esos renglones.

#### Scenario: Export coincide con la pantalla

- **WHEN** se exporta a CSV el mismo rango
- **THEN** cada renglón y monto del CSV coincide con `lines`

### Requirement: Datos del dueño efectivo

Todas las sumas SHALL filtrarse por el dueño efectivo con `buildOwnerFilter`, igual que el resto de los reportes.

#### Scenario: Alcance propio

- **WHEN** un usuario con `report:read` en alcance `OWN` pide el reporte
- **THEN** sólo se suman sus ventas, gastos, nómina, impuestos y activos
