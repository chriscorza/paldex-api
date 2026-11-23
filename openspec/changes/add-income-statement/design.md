## Context

`GET /reports/monthly` arma su P&L con `ReportsAggregationService.getAggregates` y `ProfitEngine.calculate`. La clasificación de cada peso sale de tres lugares:

- **Gastos:** su categoría (`ExpenseCategory.type` y `affects_operating_profit`), en `sumExpensesByPurpose`.
- **Nómina:** `PayrollPayment.net_amount` con `status = PAID`, por `paid_at`.
- **Impuestos:** todo `TaxPayment` por `paid_at`, sin mirar el tipo.

Todo es base de efectivo, salvo el COGS, que sale de `CostOfGoodsSold` por fecha de la venta (regla de no duplicación 3 de `CLAUDE.md`). El estado de resultados conserva esa base. Lo que cambia es **en qué renglón cae cada peso**, más dos fuentes nuevas: la depreciación de `FixedAsset` y la separación de intereses.

## Goals / Non-Goals

**Goals**
- Un EBITDA que se pueda defender: sin intereses, sin ISR, sin depreciación ni amortización, y con todo el costo de la operación adentro (cuotas de nómina incluidas).
- Que cada peso pagado caiga en exactamente un renglón, del P&L o del bloque de flujo, y que la suma lo compruebe.
- Un rango de fechas libre, para ver un mes, un trimestre o el año acumulado.

**Non-Goals**
- Base devengada, doble depreciación fiscal y contable, balance general.

## Decisions

### 1. La nómina en el P&L es "neto pagado + `PAYROLL_TAX`", no `gross_amount`

El costo real de la nómina es el sueldo bruto más las cuotas patronales. En efectivo, ese dinero sale por dos caminos:
- **El neto**, a la cuenta del empleado (`PayrollPayment.net_amount`).
- **Lo retenido y las cuotas patronales**, al SAT, IMSS o estado (`TaxPayment` con `type = PAYROLL_TAX`).

Sumar `gross_amount` más `PAYROLL_TAX` contaría dos veces lo retenido, porque ya va dentro de ambos. Sumar neto más `PAYROLL_TAX` da exactamente lo que salió de caja por la nómina. El reporte lo muestra en dos subrenglones, "Sueldos pagados (neto)" y "Cuotas e impuestos de nómina", para que se vea de dónde sale cada parte.

*Alternativa descartada:* agregar a `PayrollPayment` un campo de cuotas patronales. Pediría capturar algo que hoy ya se registra como `TaxPayment`, y abriría una segunda fuente de verdad, contra la regla 2 de no duplicación.

### 2. Impuestos según `TaxPaymentType`

| Tipo | Renglón | Por qué |
|---|---|---|
| `IVA` | Bloque de flujo, fuera del P&L | Se cobra al cliente y se entera al SAT; no es gasto. |
| `PAYROLL_TAX` | Nómina (operación, arriba del EBITDA) | Es costo de tener empleados. |
| `ISR` | "Impuestos a la utilidad", abajo de la UAI | Es la "T" del EBITDA. |
| `OTHER` | Gastos operativos, renglón "Otros impuestos y derechos" | Ver la pregunta abierta 2. Por omisión es lo conservador: baja el EBITDA en vez de inflarlo. |

Sólo cuentan los `TaxPayment` con `status = PAID` y `paid_at` dentro del rango.

### 3. Intereses: tipo de categoría `INTEREST`, no una marca nueva

Hoy los intereses se distinguen del pago de capital sólo por el override `affects_operating_profit` de una categoría `DEBT`. Para el estado de resultados hace falta saber "esto es interés" sin depender del nombre ni de un override, así que se agrega el valor `INTEREST` a `ExpenseCategoryType`, con estas marcas por omisión:
- `affects_gross_profit: false`
- `affects_operating_profit: false`
- `is_cash_outflow: true`

La migración pasa a `INTEREST` las categorías del sistema llamadas "Intereses de deuda" y ajusta su `affects_operating_profit` a `false`. Las categorías `DEBT` que creó el usuario no se tocan: siguen siendo pago de capital y van al bloque de flujo.

**Efecto en `GET /reports/monthly`:** al pasar a `affects_operating_profit: false`, los intereses dejan de restarse en su utilidad operativa y su utilidad neta, porque `ProfitEngine` no tiene renglón de intereses. Para que el reporte mensual no "gane" dinero de la nada, `sumExpensesByPurpose` suma `INTEREST` a `operating` mientras ese reporte no se alinee (ver la pregunta abierta 1). Así su resultado no cambia.

### 4. `CAPEX`: la compra del activo es flujo y la depreciación es P&L

Se agrega el tipo `CAPEX`, con `affects_operating_profit: false` e `is_cash_outflow: true`, y la categoría del sistema "Compra de activo fijo". Un gasto en esa categoría aparece en el bloque de flujo como "Compra de activos" y nunca en el P&L. Lo que pega en el P&L es la depreciación mensual del `FixedAsset`.

`FixedAsset.expense_id` es un vínculo opcional al gasto con el que se pagó. Sirve para ir del activo a su pago y viceversa. El reporte no lo necesita para clasificar, porque eso lo decide la categoría.

**Riesgo de doble conteo con lo ya capturado:** una compra vieja registrada como "Renta local" o "Reinversión" seguirá restando como gasto mientras su activo también se deprecia. Hay dos mitigaciones:
- Al crear un activo con `expense_id`, si el gasto vinculado no es `CAPEX`, el API responde `400` con el nombre de la categoría actual y pide recategorizarlo. No lo cambia solo, porque cambiar la categoría de un gasto mueve meses que quizá ya se cerraron.
- El estado de resultados publica `warnings`, con los activos sin `expense_id` cuya fecha de compra cae en el rango, como recordatorio de revisar si su compra quedó capturada en otra categoría.

### 5. Depreciación calculada al leer, no guardada

La depreciación de un mes es una función pura del activo:
- **Base depreciable:** `acquisition_cost − salvage_value`.
- **Cuota mensual:** base ÷ `useful_life_months`, redondeada a centavos. El último mes absorbe el residuo, así que la suma da exactamente la base.
- **Desde:** el primer día del mes siguiente a `in_service_at`. Es la regla del SAT (art. 31 LISR) y evita prorratear días.
- **Hasta:** que se agota la vida útil, o el mes de `disposed_at` (exclusivo), lo que ocurra primero.
- La cuota del mes se asigna completa a ese mes calendario. Un rango que toma sólo parte de un mes lleva la cuota completa si incluye el día 1, y nada si no lo incluye. Así, sumar meses sueltos da lo mismo que pedir el rango entero.

Se calcula al leer (`src/fixed-assets/depreciation.ts`, función pura con pruebas propias) en vez de generar asientos mensuales por cron, por tres razones:
- No hay un cron que se pueda saltar un mes.
- Corregir un activo (vida útil, costo) corrige todos los meses de forma coherente.
- No aparecen filas nuevas que mantener.

El costo de esta decisión es que editar un activo cambia meses ya cerrados. `MonthlyClose` ya resuelve ese problema para los gastos con `source_fingerprint`, así que se agregan al fingerprint los `FixedAsset` del dueño (id, costo, fechas, vida útil, residual, baja). Un mes cerrado detecta el cambio igual que detecta un gasto editado.

### 6. Clases de activo con vidas útiles del SAT por omisión

`FixedAssetClass` determina la vida útil sugerida, que es el 100 % entre la tasa máxima del art. 34 de la LISR:

| Clase | Tasa | Vida útil por omisión |
|---|---|---|
| `COMPUTER` | 30 % | 40 meses |
| `VEHICLE` | 25 % | 48 meses |
| `FURNITURE` (mobiliario y equipo de oficina) | 10 % | 120 meses |
| `MACHINERY` (maquinaria y equipo) | 10 % | 120 meses |
| `LEASEHOLD_IMPROVEMENT` (adaptaciones a local) | 5 % | 240 meses |
| `SOFTWARE` (`kind = INTANGIBLE`) | 15 % (gastos diferidos, art. 33) | 80 meses |
| `OTHER` | 10 % | 120 meses |

`useful_life_months` se guarda siempre. La clase sólo propone el valor al crear el activo, de modo que cambiar la tabla después no altera activos existentes.

### 7. Baja de activos

`disposed_at` y `disposal_amount` (lo que se recibió, o `0` si se tiró o se rompió). La depreciación se detiene en ese mes. En el estado de resultados, el mes de la baja registra "Ganancia/pérdida en baja de activos", que es `disposal_amount` menos el valor en libros a esa fecha, en el renglón "Otros resultados", abajo del EBIT y fuera del EBITDA. El dinero recibido aparece en el bloque de flujo como "Venta de activos".

### 8. El bloque de flujo de efectivo

Para que se vea que no se perdió nada, la respuesta incluye `cash_items`, un bloque que no afecta la utilidad, con:
- IVA enterado
- Compra de activos (`CAPEX`)
- Venta de activos
- Compras de inventario (`COGS`, como hoy en `inventory_purchases`)
- Pago de capital de deuda (`DEBT`)
- Retiros del dueño y reinversión (`OWNER`)

Una prueba de cuadre asegura que todo gasto pagado del rango cae en exactamente un renglón del P&L o de `cash_items`.

### 9. Fechas, límites y forma de la respuesta

- **Rango:** `start_date` y `end_date` son obligatorios, en la zona horaria del negocio (`src/common/timezone.ts`). Tope de 366 días, con `400` si se excede, igual que `sales-daily`. Sin "mes en curso" por omisión, por la misma regla de un solo reloj.
- **Respuesta:** `lines` es una lista ordenada de renglones `{ key, label, amount, level, children? }`, para que el front y el CSV pinten exactamente lo mismo. Además lleva un bloque `summary` con los subtotales con nombre fijo (`net_sales`, `gross_profit`, `ebitda`, `ebit`, `pre_tax_income`, `net_income`), los márgenes de cada uno con `percentage()`, `cash_items`, `quality` y `warnings`.
- **Calidad de datos:** se arrastra `quality.cost_data_coverage` del reporte mensual. Con COGS incompleto, la utilidad bruta y todo lo que está debajo son un techo, y la respuesta lo dice.
- **Export:** `GET /reports/income-statement/export?format=csv` reutiliza los mismos `lines`.

## Risks / Trade-offs

- **Dos reportes con números distintos.** Mientras `GET /reports/monthly` no se alinee, su "utilidad neta" (que resta el IVA) y la del estado de resultados no van a coincidir. Esto se mitiga con la pregunta abierta 1 y con una nota en la página.
- **Clasificación por nombre que sobrevive.** `Reinversión` contra `Retiro del dueño` sigue dependiendo del nombre de la categoría. No cambia en este cambio y no afecta al P&L, porque ambas van al bloque de flujo.
- **Precisión de la depreciación.** Línea recta con meses completos no es la depreciación fiscal exacta (INPC, deducción inmediata). Es la que sirve para el EBITDA de gestión, y así se documenta.

## Migration Plan

1. Migración aditiva:
   - modelo `FixedAsset` y enums `FixedAssetKind` (`TANGIBLE`, `INTANGIBLE`) y `FixedAssetClass`;
   - valores `INTEREST` y `CAPEX` en `ExpenseCategoryType`;
   - `UPDATE expense_categories SET type = 'INTEREST', affects_operating_profit = false WHERE is_system = true AND name = 'Intereses de deuda'`.
2. Agregar "Compra de activo fijo" a `SYSTEM_CATEGORIES`. Se siembra igual que las demás para cuentas nuevas, y la migración la inserta en las cuentas existentes.
3. Después del deploy, el dueño registra sus activos y recategoriza las compras que ya había capturado.
4. Rollback: los enums nuevos no se pueden quitar mientras haya filas que los usen. Para volver atrás, se revierten las categorías a `DEBT`/`OTHER` y luego se baja la migración.

## Open Questions

1. **¿Se alinea `GET /reports/monthly` en este mismo cambio?** Recomendación: sí, en un cambio siguiente y corto. Su utilidad neta pasaría a usar la clasificación de impuestos del estado de resultados (dejar de restar IVA), y el `net_profit` que guarda `MonthlyClose` cambiaría para meses nuevos. Aquí se deja fuera para no mover números de meses ya cerrados sin decidirlo explícitamente.
2. **`TaxPaymentType.OTHER`:** ¿predial, tenencia y derechos (operación) o algo más? Si en la práctica se usa para otra cosa, la tabla de la decisión 2 cambia.
