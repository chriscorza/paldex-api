## Why

Con MVP 1 y MVP 2 la API ya calcula la utilidad real de un mes y explica de dónde sale. Lo que falta es **convertir eso en una operación mensual repetible**, y hay cuatro huecos concretos que hoy obligan a trabajar a mano:

1. **Los gastos fijos se capturan cada mes.** La renta, el internet, el contador, las suscripciones — los mismos diez conceptos, treinta veces al año. Y lo peor no es teclearlos: es **olvidarlos**. Un gasto fijo que nadie capturó no aparece en ningún reporte, y la utilidad del mes sale inflada sin que nada lo indique.
2. **El dinero disponible es incompleto por diseño.** `GET /reports/cash` de MVP 1 declara `excluded_liabilities: ["accounts_payable"]` porque las cuentas por pagar no existen en el modelo. Un saldo de $50 000 con $30 000 comprometidos a proveedores no es $50 000 disponibles.
3. **Los reportes históricos cambian solos.** MVP 1 decidió reportes dinámicos: corregir un gasto de junio reescribe la utilidad de junio. Es lo correcto mientras un mes está abierto, y es un problema cuando ese número ya se usó para tomar una decisión. Nada distingue "junio, en revisión" de "junio, cerrado".
4. **No hay comparación ni exportación.** Saber que julio dejó $30 000 sirve a medias sin saber que junio dejó $42 000, y no hay forma de sacar un mes a CSV para el contador.

## What Changes

### Gastos recurrentes: plantilla y generación

- Nuevo modelo `RecurringExpense`, una **plantilla**: `concept`, `amount`, `category_id`, `account_id?`, `frequency` (`WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`), la configuración de día de vencimiento según periodicidad, `start_date`, `end_date?`, `active`, `auto_generate`, `requires_confirmation`, `notes`.
- `POST /recurring-expenses/generate` crea los `Expense` del periodo en estado **`PENDING`**, nunca `PAID`. La plantilla recuerda que el gasto existe; la confirmación de que el dinero salió la da una persona.
- Idempotencia por llave lógica `(recurring_expense_id, scheduled_due_date)`, con índice único. La generación se puede llamar tantas veces como se quiera.
- **El monto del gasto generado es editable** sin tocar la plantilla: el internet cuesta $700 en la plantilla y $740 este mes.
- Reutiliza el cálculo de fechas: la misma regla de calendario que la nómina de MVP 1 —si el día configurado no existe en el mes, se usa el último día del mes.
- `Expense` gana `recurring_expense_id?`, `scheduled_due_date?` e `is_recurring`, para poder distinguir gasto fijo de gasto variable en los reportes.

### Cuentas por pagar y por cobrar

- Nuevo modelo `Payable`: `vendor`, `concept`, `total_amount`, `paid_amount`, `due_date`, `status` (`PENDING`, `PARTIAL`, `PAID`, `CANCELLED`, `OVERDUE`), `account_id?`, `notes`.
- `POST /payables/:id/payments` registra abonos. `paid_amount` y `status` se derivan de los abonos, no se capturan: un pagaré de $10 000 con $4 000 abonados está `PARTIAL` con `4000`, y nadie puede teclear otra cosa.
- Un abono MUST NOT exceder el saldo pendiente.
- `OVERDUE` se **deriva** de `due_date` contra la fecha actual — no es un estado que alguien escriba y luego se quede obsoleto.
- Nuevo modelo `Receivable`, simétrico: `customer`, `concept`, `total_amount`, `collected_amount`, `due_date`, `status`, `related_income_id?`.
- **El disponible deja de ser incompleto**: `GET /reports/cash` resta cuentas por pagar vencidas y por vencer en el periodo, y `excluded_liabilities` se vacía.

### Cierre mensual

- Nuevo modelo `MonthlyClose`: `year`, `month`, `status` (`OPEN`, `REVIEWING`, `CLOSED`), el **snapshot** completo de las cifras del mes (`income_total`, `expense_total`, `cogs_total`, `payroll_total`, `tax_total`, `net_profit`, `cash_available`), `closed_at`, `closed_by_user_id`, `notes`.
- `GET /monthly-close/:year/:month/preflight` — la revisión previa: gastos pendientes, nómina pendiente, impuestos pendientes, ventas sin costo capturado, gastos pendientes de factura, deriva de saldo. Cerrar un mes con pendientes es posible, pero nunca por accidente.
- `POST /monthly-close/:year/:month/close` congela el snapshot. Desde ese momento, `GET /reports/monthly` de ese mes devuelve **el snapshot**, no un recálculo.
- **Escrituras bloqueadas en un mes cerrado**: crear, editar o borrar un gasto, ingreso, pago de nómina o pago de impuestos con fecha dentro de un mes cerrado responde `409 Conflict`. Aplica también a la recalculación de costos de MVP 2 sobre un periodo cerrado.
- `POST /monthly-close/:year/:month/reopen` exige un `reason` y queda registrado. Reabrir es una decisión, no un clic.
- Un mes no se puede cerrar si el anterior está abierto — los cierres van en orden.
- **Huella de insumos en el snapshot**: además de los totales, el cierre guarda el conteo y la suma de cada tabla de origen del periodo, versionada. Cualquier escritura que se cuele cambia un conteo o una suma.
- `GET /monthly-close/:year/:month/integrity` compara la huella guardada contra la actual y responde `OK` o `DIVERGED`, diciendo **qué tabla** cambió. Cuesta unas agregaciones, no recalcular el reporte.
- **La divergencia se descubre sola**: el preflight de un mes verifica la integridad del mes anterior cerrado, y una divergencia **bloquea** el cierre. Un hueco en la guardia sale a la luz al mes siguiente, sin que nadie tenga que acordarse de revisarlo.
- **Test de lista blanca de caminos de escritura**: una prueba escanea el código en busca de escrituras a los modelos financieros y exige que cada archivo que aparezca esté en una lista explícita de servicios con guardia. Añadir un módulo que escriba gastos rompe la prueba en el PR, no seis meses después en producción.

### Comparación y tendencias

- `GET /reports/compare?periods=2026-05,2026-06,2026-07` — los mismos renglones del estado de resultados, en columnas, con variación absoluta y porcentual entre periodos consecutivos.
- `GET /reports/trends?months=12` — serie mensual de ingresos netos, utilidad bruta, utilidad operativa, utilidad neta, márgenes y `payroll_ratio`.
- Cada periodo de la respuesta declara si viene de un **snapshot cerrado** o de un **cálculo dinámico**. Comparar un mes cerrado con uno abierto es legítimo; no saber cuál es cuál, no.

### Exportaciones

- `GET /reports/monthly/export?format=csv` y `format=pdf` — el estado mensual completo.
- `GET /expenses/export?format=csv` y `GET /incomes/export?format=csv` — los movimientos del periodo con todos sus campos, incluidos los fiscales, para entregar al contador.
- CSV con codificación UTF-8 con BOM y separador configurable, porque el destino real es Excel en español.
- PDF con una plantilla mínima generada en el servidor. Si la única forma de conseguir PDF fuera una dependencia pesada de renderizado, se entrega CSV y el PDF queda documentado como pendiente — no se mete un navegador headless en la API por un reporte.

### No incluido (non-goals)

- **Nada de frontend.** Las pantallas `/cierre-mensual`, `/reportes` y las de gastos recurrentes no se construyen aquí.
- **No se cambian las fórmulas financieras.** El cierre congela lo que MVP 1 calcula; la comparación alinea los mismos renglones. Ninguna cifra se define de nuevo.
- **No hay ajustes contables sobre meses cerrados.** Si algo de un mes cerrado está mal, se reabre. No se implementa el asiento de ajuste en el mes siguiente.
- **No hay conciliación bancaria.** La deriva de saldo se reporta; no se importan estados de cuenta ni se casan movimientos.
- **No hay recordatorios ni notificaciones.** El preflight y las listas de pendientes están disponibles vía API; quién avisa a quién es problema del frontend.
- **Sin scheduler.** La generación de gastos recurrentes es un endpoint idempotente, igual que la nómina.
- **No se modela crédito ni intereses de cuentas por pagar.** Un `Payable` es un monto con vencimiento; los intereses se capturan como gasto de categoría `DEBT`.
- **Facturación electrónica, CFDI y timbrado**: fuera de alcance, como en todos los changes anteriores.

## Capabilities

### New Capabilities
- `recurring-expenses`: plantillas de gasto fijo, generación idempotente de gastos pendientes por periodo, monto editable en el gasto generado sin alterar la plantilla, y la separación de gasto fijo y variable en los reportes.
- `payables-receivables`: cuentas por pagar y por cobrar con abonos, estado derivado del saldo, vencimiento calculado, y su efecto sobre el dinero realmente disponible.
- `monthly-close`: el ciclo de cierre —revisión previa, snapshot congelado con huella de sus insumos, bloqueo de escrituras retroactivas, detección de divergencia entre snapshot y datos, y reapertura con motivo registrado.
- `report-comparison`: comparación de periodos y series de tendencia, con la procedencia de cada cifra declarada.
- `report-exports`: exportación del estado mensual y de los movimientos a CSV y PDF.

### Modified Capabilities
- `expenses-crud`: el gasto gana `recurring_expense_id`, `scheduled_due_date` e `is_recurring`; las escrituras se rechazan cuando su fecha cae en un mes cerrado; el listado acepta el filtro `is_recurring`.
- `financial-reports`: `GET /reports/monthly` devuelve el snapshot en meses cerrados en lugar de recalcular, y `GET /reports/cash` deja de excluir las cuentas por pagar.

## Impact

**Depende de**: `add-financial-model-core` (MVP 1) para las fórmulas, el motor de cálculo, la aritmética decimal y el cálculo de fechas por periodicidad. `add-shopify-profitability` (MVP 2) es opcional: si está aplicado, la recalculación de costos también respeta los meses cerrados.

**Base de datos** — migración:
- `RecurringExpense`: `id`, `concept`, `amount`, `category_id`, `account_id?`, `frequency`, `due_day_of_week?`, `due_day_of_month?`, `second_due_day_of_month?`, `start_date`, `end_date?`, `active`, `auto_generate`, `requires_confirmation`, `notes?`, `user_id`.
- `Payable`: `id`, `vendor`, `concept`, `total_amount`, `paid_amount`, `due_date`, `status`, `account_id?`, `notes?`, `user_id`.
- `PayablePayment`: `id`, `payable_id`, `amount`, `paid_at`, `account_id`, `notes?`.
- `Receivable`: `id`, `customer`, `concept`, `total_amount`, `collected_amount`, `due_date`, `status`, `related_income_id?`, `notes?`, `user_id`.
- `ReceivableCollection`: `id`, `receivable_id`, `amount`, `collected_at`, `account_id`, `notes?`.
- `MonthlyClose`: `id`, `year`, `month`, `status`, los siete totales del snapshot, `source_fingerprint` (JSON con conteo y suma por tabla de origen), `fingerprint_version`, `closed_at?`, `closed_by_user_id?`, `reopened_reason?`, `notes?`, `user_id`, con `@@unique([user_id, year, month])`.
- `Expense`: `recurring_expense_id?`, `scheduled_due_date?`, `is_recurring`.
- Nuevos enums: `RecurringFrequency`, `PayableStatus`, `ReceivableStatus`, `MonthlyCloseStatus`.
- Índice único `(recurring_expense_id, scheduled_due_date)` en `Expense` para la idempotencia de la generación.
- Índices: `Payable(due_date)`, `Payable(status)`, `Receivable(due_date)`, `MonthlyClose(year, month)`.
- Todo el dinero en `Decimal(14,2)`.

**Código nuevo**
- `src/recurring-expenses/`, `src/payables/`, `src/receivables/`, `src/monthly-close/`.
- `src/monthly-close/close-guard.ts` — la comprobación reutilizable de "¿esta fecha cae en un mes cerrado?", aplicada desde los servicios de expenses, incomes, payroll, tax-payments y la recalculación de MVP 2.
- `src/monthly-close/fingerprint.service.ts` — cálculo y comparación de la huella de insumos de un periodo.
- `src/monthly-close/__tests__/write-paths.spec.ts` — el test de lista blanca de caminos de escritura.
- `src/reports/comparison.service.ts` y `src/reports/export.service.ts`.
- `src/common/csv.ts` — serialización CSV con UTF-8 BOM y escapado.

**Código modificado**
- `src/expenses/` — campos nuevos, filtro `is_recurring`, guardia de mes cerrado.
- `src/incomes/`, `src/payroll/`, `src/tax-payments/` — guardia de mes cerrado.
- `src/reports/` — `GET /reports/monthly` sirve snapshot en meses cerrados; `GET /reports/cash` resta cuentas por pagar.
- `src/permissions/permission-catalog.ts` — permisos `recurring_expense`, `payable`, `receivable`, `monthly_close`.
- `src/app.module.ts` — registrar los módulos nuevos.

**Contrato de API**: aditivo salvo un cambio de comportamiento deliberado — las escrituras sobre fechas de un mes cerrado empiezan a devolver `409 Conflict`. Es el punto del change, y sólo aplica a meses que alguien cerró explícitamente.

**Dependencias**: `package.json` sin cambios para CSV. El PDF puede requerir una dependencia ligera de generación; si la única opción viable es un renderizador pesado, se entrega sólo CSV y el PDF queda documentado como pendiente.

**Riesgo principal**: la guardia de mes cerrado hay que invocarla en cada camino de escritura, y hoy son ~22 —crecen con cada change futuro. La prevención por invocación es best-effort por naturaleza: no cubre `$queryRaw`, ni scripts, ni nadie tocando la base a mano, y un camino olvidado no rompe ninguna prueba.

Por eso este change no apuesta a una prevención perfecta, sino a que **la divergencia sea imposible de pasar por alto**: la huella de insumos la vuelve detectable con unas agregaciones, el preflight del mes siguiente la saca a la luz sin que nadie la busque, y el test de lista blanca hace que un camino nuevo falle en el PR. La palabra que sale del riesgo es "en silencio".
