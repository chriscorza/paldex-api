## Why

El dueño necesita un estado de resultados (P&L) con EBITDA. `GET /reports/monthly` ya calcula utilidad bruta, operativa y neta, pero no sirve para eso porque mezcla en sus renglones justo lo que el EBITDA tiene que separar:

- **Intereses dentro de la operación.** La categoría del sistema "Intereses de deuda" es `DEBT` con `affects_operating_profit: true`, así que se resta en gastos operativos. El EBITDA tiene que excluir los intereses.
- **No hay depreciación ni amortización.** No existe modelo de activos fijos. Una computadora, un anaquel o una remodelación se registra hoy como gasto operativo (pega completo en un mes) o como "Reinversión" (`OWNER`, no aparece en el P&L). Ninguna de las dos es correcta, y el dueño sí tiene activos.
- **Todos los impuestos se restan juntos.** `taxes_paid` suma todo `TaxPayment` sin ver el tipo:
  - El **IVA** no es gasto: se cobra y se entera al SAT.
  - **`PAYROLL_TAX`** es costo de la nómina y pertenece a la operación.
  - Sólo el **ISR** es el impuesto que el EBITDA suma de regreso.
- **Gastos que desaparecen.** Las categorías `SHOPIFY_FEES` y `SHIPPING` tienen `affects_gross_profit: true` y `affects_operating_profit: false`, pero `sumExpensesByPurpose` nunca resta nada contra la utilidad bruta. Un gasto capturado a mano en esas categorías (la suscripción de Shopify, por ejemplo) no aparece en ningún renglón.
- **Sólo por mes.** El reporte acepta `year`/`month` y no un rango, así que no hay acumulado del año.

## What Changes

- **Nuevo registro de activos fijos** (`FixedAsset`): CRUD en `/fixed-assets` con costo, fecha de entrada en uso, vida útil, valor residual y baja.
  - La depreciación se calcula en línea recta y mes por mes, a partir del mes siguiente a la entrada en uso, como lo hace el SAT.
  - Los intangibles (licencias plurianuales, registro de marca) usan el mismo modelo con `kind = INTANGIBLE` y se reportan como amortización.
  - La vida útil por omisión sale de la clase del activo, con las tasas máximas del art. 34 de la LISR. El dueño puede cambiarla.
- **Nuevos tipos de categoría de gasto: `INTEREST` y `CAPEX`.**
  - `INTEREST` saca los intereses de la operación. La categoría del sistema "Intereses de deuda" se migra a este tipo.
  - `CAPEX` es la compra de un activo fijo: es salida de efectivo pero no gasto del P&L. Lo que entra al P&L es su depreciación.
  - Se agrega la categoría del sistema "Compra de activo fijo".
- **Nuevo endpoint `GET /reports/income-statement?start_date&end_date`**, en base de efectivo, con renglones por categoría:

  ```
  Ventas netas
  − Costo de lo vendido (CostOfGoodsSold) − otros costos de venta (SHOPIFY_FEES, SHIPPING)
  = Utilidad bruta
  − Gastos operativos (por categoría)
  − Nómina: neto pagado + PAYROLL_TAX
  = EBITDA
  − Depreciación − Amortización
  = Utilidad operativa (EBIT)
  − Intereses ± otros resultados (ganancia/pérdida en baja de activos)
  = Utilidad antes de impuestos
  − ISR
  = Utilidad neta
  ```

  Aparte, sin tocar la utilidad, se informa la parte que sólo es flujo de efectivo: IVA enterado, compra de activos, compras de inventario, pago de capital, retiros y reinversión.
- **Export a CSV** del estado de resultados.
- **Tool MCP `income_statement`**, sólo lectura con `report:read`, con fechas explícitas como el resto.
- **Front:** página "Activos fijos" y página "Estado de resultados" en Reports.

## Capabilities

### New Capabilities
- `fixed-assets`: registro de activos fijos e intangibles y su depreciación o amortización mensual.
- `income-statement`: estado de resultados por rango de fechas con EBITDA, EBIT y utilidad neta.

### Modified Capabilities
- `mcp-server`: el registro de tools pasa de siete a ocho, con una tool más de sólo lectura.

## Non-goals

- **Base devengada.** El estado de resultados es en base de efectivo, igual que `GET /reports/monthly`. Las cuentas por pagar no entran.
- **Depreciación fiscal frente a contable.** Hay una sola depreciación, en línea recta. No se llevan dos libros ni la deducción inmediata.
- **Cambiar `GET /reports/monthly` en este cambio.** Ver la pregunta abierta en `design.md`.
- **Balance general.** El valor en libros de los activos se expone en `/fixed-assets`, pero no se arma un balance.

## Impact

- **Esquema:**
  - modelo `FixedAsset` más los enums `FixedAssetKind` y `FixedAssetClass`;
  - valores `INTEREST` y `CAPEX` en `ExpenseCategoryType`;
  - migración de datos que pasa "Intereses de deuda" a `INTEREST`.

  Todo es aditivo, salvo el `UPDATE` de esa categoría.
- **Código nuevo:**
  - `src/fixed-assets/` (módulo, servicio, controlador, DTOs y cálculo de depreciación);
  - `src/reports/income-statement.service.ts`;
  - la tool en `src/mcp/mcp-tools.service.ts`.
- **Permisos:** `fixed_asset:create|read|update|delete`, con sus variantes `OWN`, en `PERMISSION_CATALOG`. El rol admin los recibe al arrancar.
- **Front (`paldex-app`):** dos páginas nuevas, sus resources, tipos y traducciones.
- **Datos existentes:** las compras de activos que ya se capturaron como gasto operativo o como "Reinversión" se tienen que recategorizar a "Compra de activo fijo" al registrar el activo. Si no, se cuentan dos veces: una como gasto y otra como depreciación. La pantalla de activos lo advierte y el reporte señala gastos grandes sin recategorizar (ver `design.md`).
