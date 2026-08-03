## ADDED Requirements

### Requirement: Estados del cierre mensual

Un `MonthlyClose` SHALL existir por cada `(user_id, year, month)`, único, con `status` en `OPEN`, `REVIEWING` o `CLOSED`.

Un mes sin registro MUST tratarse como `OPEN`: el sistema MUST NOT exigir crear el registro antes de operar.

Las transiciones permitidas SHALL ser `OPEN → REVIEWING`, `REVIEWING → CLOSED`, `OPEN → CLOSED`, `CLOSED → OPEN` (reapertura). Cualquier otra MUST responder `409 Conflict`.

#### Scenario: Mes sin registro es abierto

- **WHEN** se consulta `GET /monthly-close/2026/9` de un mes sin registro
- **THEN** la respuesta indica `status: OPEN` sin haber creado ninguna fila

#### Scenario: Marcar un mes en revisión

- **WHEN** se envía `POST /monthly-close/2026/7/review`
- **THEN** el mes queda en `REVIEWING`, y las escrituras siguen permitidas

#### Scenario: Transición inválida

- **WHEN** se intenta pasar un mes `CLOSED` a `REVIEWING`
- **THEN** el sistema responde `409 Conflict`

### Requirement: Revisión previa al cierre

El sistema SHALL exponer `GET /monthly-close/:year/:month/preflight`, que devuelve todo lo que quedó suelto en el mes:

```
pending_expenses          monto y conteo
pending_payroll           monto y conteo
pending_taxes             monto y conteo
fixed_expenses_pending    monto y conteo
sales_without_cost        monto y conteo
pending_invoice_expenses  monto y conteo
account_balance_drift     por cuenta
payables_overdue          monto y conteo
blocking_issues           lista de problemas que impiden cerrar
warnings                  lista de pendientes que no impiden cerrar
```

Cerrar un mes con pendientes SHALL permitirse: los pendientes son `warnings`, no `blocking_issues`. Es una decisión informada, no un obstáculo.

`blocking_issues` MUST contener únicamente lo que hace imposible un cierre coherente: que el mes anterior siga abierto, que el mes que se pretende cerrar sea futuro, o que el mes anterior esté cerrado pero su snapshot haya divergido de sus datos.

#### Scenario: Revisión con pendientes

- **WHEN** se pide el preflight de un mes con `3200` en gastos fijos pendientes y `8000` de nómina pendiente
- **THEN** la respuesta los lista en `warnings` con sus montos, y `blocking_issues` está vacío

#### Scenario: Revisión de un mes limpio

- **WHEN** se pide el preflight de un mes sin pendientes de ningún tipo
- **THEN** `warnings` y `blocking_issues` están vacíos

#### Scenario: Mes anterior abierto

- **WHEN** se pide el preflight de agosto y julio sigue `OPEN`
- **THEN** `blocking_issues` incluye que el mes anterior no está cerrado

#### Scenario: Mes futuro

- **WHEN** se pide el preflight de un mes posterior al actual
- **THEN** `blocking_issues` incluye que no se puede cerrar un mes que no ha terminado

### Requirement: El cierre congela un snapshot

El sistema SHALL exponer `POST /monthly-close/:year/:month/close`, que calcula el estado mensual del periodo y lo persiste como snapshot en el `MonthlyClose`, con `income_total`, `expense_total`, `cogs_total`, `payroll_total`, `tax_total`, `net_profit` y `cash_available`, más `closed_at`, `closed_by_user_id`, `source_fingerprint` y `fingerprint_version`.

El cierre MUST rechazarse con `409 Conflict` si hay `blocking_issues`.

Los cierres SHALL ir en orden: un mes MUST NOT poder cerrarse mientras exista un mes anterior con datos y sin cerrar.

#### Scenario: Cierre correcto

- **WHEN** se cierra julio de 2026 con una utilidad neta calculada de `30000`
- **THEN** el `MonthlyClose` queda en `CLOSED` con `net_profit: 30000`, su `closed_at` y el usuario que cerró

#### Scenario: Cierre fuera de orden

- **WHEN** se intenta cerrar agosto mientras julio tiene datos y está `OPEN`
- **THEN** el sistema responde `409 Conflict` indicando que hay que cerrar julio primero

#### Scenario: Cierre de un mes ya cerrado

- **WHEN** se intenta cerrar un mes que ya está `CLOSED`
- **THEN** el sistema responde `409 Conflict`

#### Scenario: Cierre con pendientes

- **WHEN** se cierra un mes con `8000` de nómina pendiente
- **THEN** el cierre se completa, y el snapshot registra las cifras tal como estaban, incluyendo los pendientes como tales

### Requirement: El snapshot guarda la huella de sus insumos

Al cerrar un mes, el sistema SHALL calcular y persistir en `source_fingerprint` el **conteo de filas y la suma monetaria** de cada tabla de origen del periodo: gastos, ingresos, pagos de nómina, pagos de impuestos y filas de costo de mercancía vendida.

Las sumas SHALL almacenarse como cadena decimal, no como número JSON, para no reintroducir punto flotante en un campo que existe para detectar diferencias exactas.

El snapshot SHALL llevar un `fingerprint_version`. Cuando la definición de la huella cambie —por ejemplo al añadir las líneas de Shopify de `add-shopify-profitability`—, la versión MUST incrementarse, y una huella de versión distinta a la vigente MUST tratarse como no comparable, **no** como divergente.

#### Scenario: Huella persistida al cerrar

- **WHEN** se cierra un mes con 42 gastos que suman `58230.00` y 310 ingresos que suman `184500.00`
- **THEN** el `source_fingerprint` guarda esos conteos y esas sumas por tabla, con las sumas como cadenas decimales, junto a la versión de la huella

#### Scenario: Cambio de definición de la huella

- **WHEN** la definición de la huella se amplía con una tabla nueva y se incrementa `fingerprint_version`, y se consulta la integridad de un mes cerrado con la versión anterior
- **THEN** el sistema responde que la huella no es comparable, y **no** reporta divergencia

### Requirement: La divergencia entre snapshot y datos se detecta

El sistema SHALL exponer `GET /monthly-close/:year/:month/integrity`, protegido por `monthly_close:read`, que recalcula la huella del periodo y la compara contra la almacenada.

La respuesta SHALL incluir:

```
status: 'OK' | 'DIVERGED' | 'NOT_CLOSED' | 'UNKNOWN_FINGERPRINT_VERSION'
sources[]: nombre, stored_count, current_count, stored_sum, current_sum, diverged
```

La comprobación MUST resolverse con agregaciones —una por tabla de origen— y MUST NOT recalcular el estado mensual completo.

Esta comprobación existe porque la guardia de escrituras es best-effort: no cubre SQL crudo, scripts, ni escrituras hechas fuera de la aplicación. La huella sí.

#### Scenario: Mes íntegro

- **WHEN** se consulta la integridad de un mes cerrado que nadie ha tocado
- **THEN** el estado es `OK` y ninguna tabla aparece como divergente

#### Scenario: Escritura que se coló

- **WHEN** un gasto de un mes cerrado se modifica por un camino sin guardia y se consulta la integridad de ese mes
- **THEN** el estado es `DIVERGED`, y la tabla de gastos aparece con su `stored_sum` y su `current_sum` distintos

#### Scenario: Divergencia por conteo sin cambio de suma

- **WHEN** en un mes cerrado se borra un gasto de `500` y se crea otro de `500`
- **THEN** el estado es `DIVERGED`, porque el conteo cambió aunque la suma coincida

#### Scenario: Mes no cerrado

- **WHEN** se consulta la integridad de un mes abierto o en revisión
- **THEN** el estado es `NOT_CLOSED` y no se reporta divergencia

#### Scenario: Coste de la comprobación

- **WHEN** se consulta la integridad de un mes con miles de movimientos
- **THEN** la respuesta se produce con una agregación por tabla de origen, sin ejecutar el cálculo del estado mensual

### Requirement: El preflight descubre la divergencia del mes anterior

`GET /monthly-close/:year/:month/preflight` SHALL comprobar la integridad del mes anterior cuando esté cerrado, e incluir el resultado en su respuesta.

Una divergencia en el mes anterior MUST registrarse como **`blocking_issue`**, no como `warning`: las cifras acumuladas del mes que se pretende cerrar —`cash_available` en particular— se apoyan en un mes cuyos números ya se movieron, así que no existe un cierre coherente encima de él.

Es la única excepción a la regla de que los pendientes no bloquean, y existe para que un hueco en la guardia salga a la luz al mes siguiente sin que nadie tenga que ir a buscarlo.

#### Scenario: Mes anterior divergente bloquea el cierre

- **WHEN** julio está cerrado, sus datos se modificaron por un camino sin guardia, y se pide el preflight de agosto
- **THEN** `blocking_issues` incluye la divergencia de julio con la tabla afectada, y `POST .../close` de agosto responde `409 Conflict`

#### Scenario: Mes anterior íntegro

- **WHEN** julio está cerrado e íntegro y se pide el preflight de agosto
- **THEN** la divergencia no aparece en `blocking_issues`

#### Scenario: Primer mes cerrado del histórico

- **WHEN** se pide el preflight de un mes cuyo mes anterior no tiene registro de cierre
- **THEN** la comprobación de integridad no aplica y no genera ningún `blocking_issue` por ese motivo

#### Scenario: Resolución de una divergencia

- **WHEN** se reabre el mes divergente y se vuelve a cerrar
- **THEN** su huella se recalcula, la integridad vuelve a `OK`, y el cierre del mes siguiente deja de estar bloqueado

### Requirement: Un camino de escritura nuevo no pasa desapercibido

El proyecto SHALL incluir una prueba que escanee el código fuente en busca de escrituras de Prisma (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`) sobre los modelos financieros —`Expense`, `Income`, `PayrollPayment`, `TaxPayment`, `CostOfGoodsSold` y, si `add-shopify-profitability` está aplicado, `ShopifyLineItem`— y que afirme, por cada archivo que aparezca:

1. que está en una lista blanca explícita de archivos autorizados a escribir esos modelos, y
2. que ese archivo referencia la guardia de mes cerrado.

Añadir un camino de escritura sin actualizar la lista MUST hacer fallar la prueba.

Esta prueba MUST NOT presentarse como demostración de que la guardia se invoca en cada rama: comprueba que alguien tomó la decisión de forma consciente, y hace que la omisión falle en el PR en vez de en producción.

#### Scenario: Módulo nuevo que escribe gastos

- **WHEN** se añade un servicio que llama a `prisma.expense.create` y no se añade a la lista blanca
- **THEN** la prueba falla nombrando el archivo y el modelo, y el PR no pasa

#### Scenario: Archivo autorizado sin guardia

- **WHEN** un archivo está en la lista blanca pero no referencia la guardia de mes cerrado
- **THEN** la prueba falla indicando que falta la guardia

#### Scenario: Camino autorizado y guardado

- **WHEN** todos los archivos que escriben modelos financieros están en la lista y referencian la guardia
- **THEN** la prueba pasa

### Requirement: Un mes cerrado se reporta desde su snapshot

Cuando un mes está `CLOSED`, `GET /reports/monthly` de ese periodo SHALL devolver **el snapshot** en lugar de recalcular.

La respuesta SHALL declarar su procedencia con `source: 'SNAPSHOT'` y su `closed_at`. Un mes abierto SHALL declarar `source: 'DYNAMIC'`.

#### Scenario: Reporte de un mes cerrado

- **WHEN** se pide `GET /reports/monthly?year=2026&month=7` de un mes cerrado
- **THEN** la respuesta devuelve las cifras del snapshot con `source: 'SNAPSHOT'` y su fecha de cierre

#### Scenario: Reporte de un mes abierto

- **WHEN** se pide el reporte de un mes sin cerrar
- **THEN** la respuesta se calcula al momento y declara `source: 'DYNAMIC'`

#### Scenario: El snapshot no cambia aunque cambien los datos

- **WHEN** se reabre un mes cerrado, se modifica un gasto, y se vuelve a cerrar
- **THEN** el snapshot refleja las cifras del segundo cierre; mientras estuvo reabierto, el reporte fue dinámico

### Requirement: Las escrituras retroactivas sobre un mes cerrado se rechazan

Crear, modificar o borrar un `Expense`, `Income`, `PayrollPayment` o `TaxPayment` cuya fecha relevante caiga dentro de un mes `CLOSED` MUST responder `409 Conflict`, indicando el mes cerrado y que hace falta reabrirlo.

La fecha relevante SHALL ser: `paid_at` o `date` para gastos, `date` para ingresos, `paid_at` o `scheduled_pay_date` para nómina, `paid_at` para pagos de impuestos.

La guardia MUST aplicarse en **todos** los caminos de escritura, incluidos `POST /expenses/:id/pay`, `POST /payroll/:id/pay`, `POST /tax-payments/:id/pay`, `POST /recurring-expenses/generate`, `POST /payroll/generate`, la escritura de filas de `CostOfGoodsSold`, y —si `add-shopify-profitability` está aplicado— `POST /shopify/recalculate-costs`.

La sincronización de Shopify MUST registrar en un reporte de conflictos las órdenes cuya fecha cae en un mes cerrado, en vez de fallar en silencio.

#### Scenario: Editar un gasto de un mes cerrado

- **WHEN** se envía `PATCH /expenses/:id` sobre un gasto pagado en julio y julio está `CLOSED`
- **THEN** el sistema responde `409 Conflict` nombrando el mes cerrado, y no modifica nada

#### Scenario: Crear un gasto con fecha en un mes cerrado

- **WHEN** se envía `POST /expenses` con `date` en julio y julio está `CLOSED`
- **THEN** el sistema responde `409 Conflict` y no crea nada

#### Scenario: Pagar hoy un gasto programado en un mes cerrado

- **WHEN** se envía `POST /expenses/:id/pay` con `paid_at` de hoy, sobre un gasto con `date` en un mes cerrado, y el mes actual está abierto
- **THEN** el sistema acepta el pago, porque la salida de dinero ocurre en el mes abierto

#### Scenario: Generación que toca un mes cerrado

- **WHEN** se ejecuta `POST /recurring-expenses/generate` con un rango que abarca un mes cerrado y uno abierto
- **THEN** se generan sólo los gastos del mes abierto, y la respuesta informa cuántos se omitieron por mes cerrado

#### Scenario: Orden de Shopify con fecha en un mes cerrado

- **WHEN** la sincronización recibe una orden con fecha en un mes cerrado
- **THEN** la orden no altera las cifras del mes cerrado, y queda registrada en el reporte de conflictos para que alguien decida

#### Scenario: Recalculación de costos sobre un periodo cerrado

- **WHEN** se ejecuta `POST /shopify/recalculate-costs` sobre un rango que incluye un mes cerrado
- **THEN** las líneas del mes cerrado no se modifican, y la respuesta lo informa

### Requirement: La reapertura exige un motivo y queda registrada

El sistema SHALL exponer `POST /monthly-close/:year/:month/reopen`, que requiere un `reason` no vacío.

Una petición sin `reason` MUST responder `400 Bad Request`.

La reapertura SHALL guardar el `reason` en `reopened_reason`, pasar el mes a `OPEN`, y **conservar el snapshot anterior y su huella** hasta que el mes se cierre de nuevo. Al volver a cerrar, ambos SHALL recalcularse.

Reabrir un mes MUST invalidar los cierres de los meses posteriores: si agosto está cerrado y se reabre julio, agosto MUST pasar a `OPEN` — sus cifras dependían de un mes que ya no está congelado.

#### Scenario: Reapertura con motivo

- **WHEN** se envía `POST /monthly-close/2026/7/reopen` con `{ "reason": "Faltó capturar la factura de renta" }`
- **THEN** el mes pasa a `OPEN`, el motivo queda registrado, y el reporte de julio vuelve a ser dinámico

#### Scenario: Reapertura sin motivo

- **WHEN** se envía la reapertura sin `reason` o con una cadena vacía
- **THEN** el sistema responde `400 Bad Request` y el mes sigue cerrado

#### Scenario: Reapertura en cascada

- **WHEN** julio y agosto están cerrados y se reabre julio
- **THEN** agosto también pasa a `OPEN`, y la respuesta informa qué meses se reabrieron en cascada

#### Scenario: El snapshot sobrevive a la reapertura

- **WHEN** se reabre un mes cerrado
- **THEN** el snapshot anterior sigue almacenado, consultable vía `GET /monthly-close/:year/:month`, marcado como perteneciente a un cierre revertido

### Requirement: Consultar el estado de los cierres

El sistema SHALL exponer `GET /monthly-close`, que lista los cierres del usuario ordenados por año y mes descendente, con su estado, snapshot y fechas.

`GET /monthly-close/:year/:month` SHALL devolver el detalle de un periodo, incluyendo el snapshot si existe.

Ambos SHALL estar protegidos por `monthly_close:read`.

#### Scenario: Listar cierres

- **WHEN** se pide `GET /monthly-close`
- **THEN** la respuesta lista los periodos con registro, del más reciente al más antiguo, con su estado y su utilidad neta congelada

#### Scenario: Petición sin permiso

- **WHEN** un usuario sin `monthly_close:create` intenta cerrar un mes
- **THEN** el sistema responde `403 Forbidden`
