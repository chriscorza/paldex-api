## Context

Paldex lleva la contabilidad en base de efectivo. Cada movimiento de dinero ya tiene cuenta y fecha
(`Income.date`, `Expense.paid_at`, `PayrollPayment.paid_at`, `TaxPayment.paid_at`,
`PayablePayment.paid_at`, `ReceivableCollection.collected_at`), pero falta el único movimiento que no es
ni ingreso ni gasto: pasar dinero de una cuenta a otra.

## Decisions

### 1. Un traspaso es una fila propia, no un par gasto/ingreso

Modelarlo como un gasto en la cuenta origen más un ingreso en la destino rompería la regla de
"cada gasto pagado cae en exactamente un renglón" del estado de resultados, inflaría las ventas y
obligaría a filtrar esas filas en cada reporte. `AccountTransfer` es una tabla aparte que sólo lee
el saldo de las cuentas.

### 2. La comisión es un `Expense` ligado

La comisión sí es gasto (la cobra Mercado Pago o el banco). Se guarda como `Expense` normal, `PAID`,
en la cuenta origen, con la fecha del traspaso y la categoría que diga quien captura
(`fee_category_id`, obligatoria si `fee_amount > 0`; no se adivina, porque el tipo de la categoría
decide el renglón del estado de resultados). El traspaso guarda `fee_expense_id` (único).

- Se crea en la misma transacción que el traspaso.
- Editar monto, fecha, cuenta origen o categoría de la comisión edita el gasto; `fee_amount = 0` lo borra.
- Borrar el traspaso borra el gasto.
- La categoría debe ser visible para el dueño (`visibleCategoriesFilter`) y no `PAYROLL`.

Así la regla de "sin duplicados" se mantiene: la comisión está una sola vez, como gasto.

### 3. Fechas de calendario en la zona del negocio

`date` llega como `YYYY-MM-DD` (o con hora, que se ignora) y se ancla a la medianoche de la zona del
negocio con `startOfDayInZone(value.slice(0, 10))`, como `FixedAssetsService`. Evita el error de otros
módulos, donde `2026-11-17` se guarda como `00:00Z`, el día anterior en CDMX.

### 4. Cierre mensual

`CloseGuard.ensureOpen` se aplica a la fecha del traspaso al crear, a la fecha anterior y a la nueva al
editar, y a la fecha al borrar. Un mes cerrado fija saldos de fin de mes: mover un traspaso hacia
dentro o fuera de él los cambiaría sin que nadie lo note.

### 5. Saldo inicial con fecha

`Account.initial_balance_at DateTime?`. Con valor, `getCashReport` filtra cada movimiento con
`fecha >= initial_balance_at`. La fecha de cada movimiento:

| Movimiento | Fecha |
|---|---|
| Ingreso | `date` |
| Gasto pagado | `paid_at`, o `date` si `paid_at` es nulo |
| Nómina pagada | `paid_at` |
| Impuesto pagado | `paid_at` |
| Traspaso | `date` |
| Pago a proveedor | `paid_at` |
| Cobro a cliente | `collected_at` |

Sin valor, no se filtra nada: el cálculo de hoy no cambia para quien no lo use.

### 6. Pagos a proveedores y cobros

Ninguno crea un `Expense` ni un `Income` (verificado en `PayablesService.addPayment` y
`ReceivablesService.addCollection`), así que sumarlos al saldo no duplica nada. Se filtran por dueño a
través de `payable.user_id` / `receivable.user_id`, porque no tienen `user_id` propio.

### 7. Validaciones

- Origen ≠ destino; `amount > 0`; `fee_amount >= 0`.
- Ambas cuentas del dueño efectivo (`buildWriteTargetFilter`): con alcance `ANY` se puede **leer**
  cualquier traspaso, pero no escribir en libros ajenos.
- Una cuenta con traspasos no se puede borrar (FK `RESTRICT` → `409`).

### 8. Permisos del rol `ai_agent`

`PermissionsService.syncCatalog` sólo otorga los permisos nuevos al rol `admin`. Para que el asistente
pueda usar las tools sin un paso manual, la migración inserta las filas de permisos (idempotente sobre
el índice único) y se las otorga con alcance `OWN` al rol `ai_agent` si existe.

## Risks

- **Saldos que cambian de golpe.** Al desplegar, los pagos a proveedores y cobros empiezan a contar.
  En producción no hay ninguno, así que el saldo no se mueve.
- **Saldo inicial con fecha mal puesta.** Si la fecha es posterior a movimientos reales, esos
  movimientos dejan de contar. El campo se documenta como "saldo al inicio de ese día".
