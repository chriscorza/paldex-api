## Context

Los changes anteriores construyeron un registro: cuentas, ingresos, gastos, impuestos como catálogo de tasas, roles y permisos, y una integración con Shopify que ya deja el desglose de cada pedido en `ShopifyOrder`. Todo eso responde "qué movimientos hubo". Ninguno responde "cuánto se ganó".

Este change es el primero cuyo producto principal no es un CRUD, sino **un número derivado**. Eso cambia las reglas del juego en tres sentidos que conviene tener claros antes de escribir código:

1. **Un número derivado hereda todos los errores de sus insumos.** Si `Expense` no distingue entre gasto pagado y gasto pendiente, la utilidad del mes está mal. Si no distingue entre pagar la renta y retirar dinero para uso personal, la utilidad operativa está mal. Buena parte de este change es **arreglar los insumos**, no construir el reporte.

2. **Hay dos formas de contar el mismo peso, y ambas son correctas.** El IVA de julio pagado el 17 de agosto es obligación de julio y salida de caja de agosto. La nómina programada el 31 de julio y pagada el 3 de agosto es gasto de agosto en base caja. El diseño no puede elegir una y descartar la otra: tiene que modelar las dos fechas y decir en cada renglón cuál usa.

3. **La aritmética tiene que ser exacta.** Todas las columnas de dinero del esquema actual son `Float`. Sumar cien filas y multiplicar costos unitarios por cantidades en punto flotante binario produce deriva de centavos. Un estado de resultados donde `net_sales - cogs ≠ gross_profit` por tres centavos no es un bug cosmético: destruye la confianza en el reporte completo, que es lo único que este change entrega.

Estado actual relevante:

- `Account.balance` es un campo **capturado a mano**. Ningún ingreso ni gasto lo modifica (verificado: `accounts.service.ts` sólo lo escribe desde el DTO). Cualquier "dinero disponible" que salga de ese campo es tan bueno como la última vez que alguien lo actualizó.
- `Expense` tiene `date` e `invoiced`, y nada más: ni categoría, ni proveedor, ni estado de pago, ni datos fiscales.
- El proyecto **no tiene scheduler**. No hay `@nestjs/schedule` en `package.json`, ni cron, ni cola.
- Los filtros, la paginación y el alcance por propietario ya están resueltos y compartidos en `src/common/filters` y `src/common/ownership.ts`. Los módulos nuevos los reutilizan; no se inventa nada.
- La documentación de la API se genera sola desde los controladores y DTOs vía `@nestjs/swagger` con el CLI plugin. Cualquier endpoint nuevo queda documentado gratis **siempre que su body y su query usen clases reales**, no tipos inline ni `Prisma.*Input`.

## Goals / Non-Goals

**Goals:**

- Que un `GET /reports/monthly?year=2026&month=7` devuelva la cadena completa —ingresos brutos → netos → utilidad bruta → operativa → neta real— con márgenes, y que cada igualdad de la cadena se cumpla exactamente.
- Que existan las entidades sin las que ese número es imposible: categorías tipificadas, costo de mercancía vendida, empleados, nómina, pagos de impuestos.
- Que el gasto distinga **gasto real** (reduce caja) de **gasto fiscalmente útil** (acredita IVA), porque son dos cosas distintas y hoy son la misma columna booleana.
- Que ningún peso se cuente dos veces. Es el riesgo principal de este diseño y hay tres lugares donde puede pasar: nómina, impuestos y COGS.
- Que la aritmética del dinero sea decimal de punta a punta, sin cambiar el contrato JSON con el frontend.
- Que el motor de cálculo sea una función pura, probada sin base de datos. Es la pieza que más importa que esté bien y la que más fácil es probar si se aísla.
- Que un reporte diga cuándo no es confiable. Un mes sin costos capturados no debe presentar una utilidad bruta inflada como si fuera un hecho.

**Non-Goals:**

- Frontend. Nada.
- Inventario. No hay existencias, ni valuación, ni costo promedio ponderado. El costo se captura por venta.
- Contabilidad fiscal real. Se estima IVA con una resta y el ISR con un porcentaje configurable. No hay regímenes, ni deducciones personales, ni tarifas progresivas, ni CFDI.
- Vista devengada. Base caja para la utilidad real, base programada para pendientes. Nada más.
- Cierre mensual, snapshots, comparación de meses y exportaciones → `add-monthly-operations`.
- Gastos recurrentes, cuentas por pagar, cuentas por cobrar → `add-monthly-operations`. Por eso el disponible de este change no resta cuentas por pagar, y lo declara.
- Rentabilidad por producto, SKU o categoría de Shopify → `add-shopify-profitability`.
- Tocar la sincronización de Shopify. Este change consume `ShopifyOrder` e `Income.source`; no cambia webhooks ni backfill.
- Multi-moneda. `MXN` en todo, validado al crear cuentas.
- Scheduler. La generación de nómina es un endpoint idempotente.

## Decisions

### 1. `Float → Decimal(14,2)`, con serialización a número en la frontera

**Decisión**: migrar todas las columnas monetarias a `Decimal(14,2)`, hacer toda la aritmética con `Prisma.Decimal` o con `SUM` en SQL, y convertir a `number` **sólo** en la proyección de entidades que sale por HTTP.

El detalle que hace esto no-trivial: el cliente de Prisma serializa `Decimal` a **string** en JSON por defecto. Si no se intercepta, `GET /expenses` empieza a devolver `"amount": "89.90"` y el frontend se rompe silenciosamente en cualquier comparación numérica. Así que hace falta una capa explícita: `src/common/money.ts` con un `toMoneyNumber(d: Decimal | null): number | null`, aplicada en los mapeos de entidad de todos los módulos que devuelven dinero.

Alternativas descartadas:

- **Dejarlo en `Float`.** Es la opción de cero trabajo, y es la razón por la que este change existiría con un defecto de origen. `0.1 + 0.2 !== 0.3` sigue siendo verdad en un estado de resultados; con doce renglones encadenados y cientos de filas por mes, la deriva es cuestión de cuándo, no de si.
- **Guardar centavos en `Int`.** Exacto y rápido, pero cambia el tipo de dato de todas las columnas existentes y de todos los DTOs, y obliga a dividir por 100 en cada lectura y multiplicar en cada escritura. Más invasivo que `Decimal` y con más superficie de error humano.
- **`Decimal` también en la respuesta HTTP, devolviendo strings.** Es lo técnicamente más puro —los strings no pierden precisión al viajar— pero rompe el contrato con el frontend, que no forma parte de este change. Se descarta por eso, no por mérito técnico.

`Tax.rate` se queda `Float`: es `0.16`, no dinero, y multiplicar una tasa por un `Decimal` da un `Decimal`.

### 2. Categorías con tipo financiero **y** banderas explícitas

**Decisión**: `ExpenseCategory` lleva `type` (el enum de 10 valores) y tres booleanos: `affects_gross_profit`, `affects_operating_profit`, `is_cash_outflow`. Los booleanos se derivan del tipo al crear, y son sobreescribibles.

El motor de reportes consulta los booleanos, no el tipo. El tipo sirve para agrupar el desglose.

Por qué no basta el tipo: el plan de negocio pide dos comportamientos que el tipo solo no puede expresar. **`DEBT` contiene dos cosas opuestas** — los intereses son gasto, el pago de capital es movimiento de caja que no toca la utilidad. Y **`OWNER` contiene retiros y reinversión**, que reducen caja pero no deben aparecer como pérdida del negocio. Cablear esas excepciones en un `switch (type)` dentro del motor las esconde en el código; ponerlas como columnas las hace visibles, auditables y ajustables sin desplegar.

Alternativa descartada: **sólo el tipo, con las reglas en el código.** Más simple de escribir y peor de mantener: el primer caso raro (un gasto de evento que es mitad marketing, mitad operación) obliga a tocar el motor en vez de a crear una categoría.

Alternativa descartada: **jerarquía de categorías con padre/hijo.** El plan pide dos niveles y el tipo ya es el primero. Un árbol arbitrario invita a profundidades que ningún reporte va a usar.

### 3. Tres fuentes de verdad separadas, cero doble conteo

Este es el corazón del diseño y donde está el riesgo real.

**Nómina**: `PayrollPayment` es la única fuente. Pagar nómina **no** crea un `Expense`. El motor proyecta `PayrollPayment` al renglón `payroll_total`, y le suma aparte los `Expense` de categorías tipo `PAYROLL` que alguien haya capturado a mano.

**Impuestos**: `TaxPayment` es la única fuente de los pagos de IVA/ISR. Pagar impuestos **no** crea un `Expense`. Los gastos de tipo `TAX` quedan para honorarios del contador, multas y trámites, y cuentan como gasto operativo — no como `taxes_paid`.

**COGS**: el renglón COGS del estado de resultados sale **exclusivamente** de `CostOfGoodsSold` casado contra ventas. Un `Expense` de categoría tipo `COGS` es **compra de inventario**: sale de caja, aparece en su propio renglón `inventory_purchases`, y no toca la utilidad bruta ni la operativa.

Por qué así: la alternativa —que cada pago genere también una fila de `Expense` "para que aparezca en gastos"— es la que primero se le ocurre a cualquiera, y garantiza contar dos veces cada peso de nómina y de impuestos, con el agravante de que la duplicación es invisible en el reporte (los totales simplemente salen altos). Una sola fuente por concepto, y el reporte que proyecta.

Y por qué separar COGS de la compra de inventario, que es la decisión menos obvia: son momentos contables distintos. Comprar 50 000 pesos de producto sellado en julio y venderlo en septiembre no es un costo de julio; es caja de julio e inventario. Sumar ambos renglones contaría el mismo producto dos veces — una al comprarlo, otra al venderlo.

### 4. El COGS incompleto se declara, no se rellena con ceros

La decisión anterior tiene un efecto secundario incómodo: si nadie captura costos por venta, el renglón COGS sale en `0` y la utilidad bruta sale igual a las ventas netas. Un número precioso y completamente falso.

**Decisión**: el reporte nunca presenta una utilidad bruta sin decir de qué está hecha. Siempre expone:

- `cogs` — el costo confirmado.
- `gross_profit_confirmed` — utilidad bruta con ese costo, o `null` si la cobertura es cero.
- `sales_without_cost` — ventas netas sin costo capturado.
- `cost_data_coverage` — porcentaje de ventas netas con costo.
- `gross_profit_purchase_basis` = `net_sales - inventory_purchases_paid` — una aproximación **claramente etiquetada**, que no se usa para calcular nada más.

Un `Income` sin filas de costo tiene `cogs_total = null`, nunca `0`. La diferencia importa: `null` significa "no sé", `0` significa "no costó nada", y sólo uno de los dos es honesto.

Alternativa descartada: **estimar el costo con un margen promedio configurable.** Suena útil y produce reportes que parecen completos, lo cual es exactamente el problema: nadie puede distinguir después qué era dato y qué era relleno. Si más adelante se quiere, tiene que ser un campo aparte y visiblemente etiquetado.

### 5. Base caja para la utilidad real, base programada para la proyección

**Decisión**: la utilidad real cuenta gastos, nómina e impuestos por su **fecha real de pago** (`paid_at`), e ingresos por su `date`. Junto a ella, cada reporte incluye un bloque `projection` con lo pendiente del periodo, medido por **fecha programada**.

Esto es exactamente lo que el plan de negocio recomienda, y la razón es práctica: el mes queda ordenado según cuándo salió el dinero de verdad, que es lo que se puede verificar contra un estado de cuenta. La base programada existe para responder "¿qué me falta pagar este mes?", que es una pregunta distinta y también necesaria.

Consecuencia visible que hay que aceptar: un pago programado el 31 de julio y pagado el 3 de agosto cuenta en agosto. Para que eso no parezca un error, el reporte de agosto lo lista en `deferred_payments` con su fecha programada de julio.

Alternativa descartada: **base devengada** (contar el gasto en el periodo al que corresponde). Es lo correcto contablemente y lo peor para empezar: exige que cada gasto declare su periodo de devengo, y produce reportes que no cuadran contra el banco, que es la única fuente de verdad que Corszas tiene hoy.

### 6. La generación de nómina es un endpoint idempotente, no un cron

**Decisión**: `POST /payroll/generate` recibe un rango de fechas, calcula las fechas de pago de cada empleado activo y crea los `PayrollPayment` faltantes en estado `PENDING`. Idempotencia garantizada por índice único `(employee_id, scheduled_pay_date, period_start, period_end)`.

Sin scheduler, por tres razones: no hay ninguno en el proyecto; añadir `@nestjs/schedule` mete estado en el proceso y este diseño ya reconoce que la caché de permisos no se propaga entre instancias; y un endpoint idempotente se puede llamar desde donde sea —el frontend al abrir la sección de nómina, un cron del sistema, curl a mano— sin cambiar nada.

El índice único hace el trabajo pesado: no hace falta razonar sobre concurrencia ni sobre "¿ya generé este mes?". Se genera y las colisiones se ignoran.

**El cálculo de fechas es una función pura** en `src/payroll/payroll-schedule.ts`, sin Prisma, sin `Date.now()`. Recibe la configuración del empleado y un rango, devuelve fechas. Los casos que se rompen en producción y no en desarrollo son todos de calendario —30 de febrero, 31 de abril, meses con cinco viernes, cambio de año— y una función pura los prueba todos en milisegundos.

Regla de calendario única: **si el día configurado no existe en el mes, se usa el último día del mes.** Aplica a quincenal y mensual, uniformemente.

### 7. El bono nunca se calcula

**Decisión**: los pagos generados nacen con `bonuses: 0`. Editable vía `PATCH /payroll/:id` mientras el pago no esté `PAID`. También se puede registrar un pago de bono independiente con `gross_amount: 0`.

Es requisito de negocio explícito: el monto depende de desempeño y criterio administrativo. Un valor por defecto distinto de cero se convertiría en el monto real por inercia — nadie edita lo que ya trae un número.

Se guarda como columna de `PayrollPayment`, no como entidad `EmployeeBonus` aparte. El plan contempla esa entidad "si se necesita más detalle"; hoy no se necesita, y una tabla más es una tabla más que sincronizar con el pago.

Un pago `PAID` se congela: editarlo devuelve `409`. Sin esa regla, la utilidad de un mes cerrado cambia cuando alguien corrige un bono viejo.

### 8. `paid_at` y `status` en `Expense`, con `invoiced` sobreviviendo por compatibilidad

**Decisión**: `Expense` gana `status` y `paid_at`. El valor por defecto al crear es `PAID` con `paid_at = date` — así el flujo actual del frontend (capturar un gasto ya desembolsado) sigue funcionando sin enviar campos nuevos.

`invoice_status` con cuatro estados pasa a ser la fuente de verdad fiscal, y el booleano `invoiced` **se conserva y se mantiene sincronizado** (`invoiced === (invoice_status === 'INVOICED')`). Cuando llegan ambos y se contradicen, gana `invoice_status`.

Podría haberse borrado `invoiced` y ya. No se hace porque el frontend lo lee hoy, y este change no toca el frontend. Mantener dos campos coherentes tiene un costo —hay que sincronizarlos en cada escritura— y es menor que el de romper una pantalla en producción.

`tax_creditable_amount` se calcula en el servidor y se rechaza si viene del cliente:

```
tax_creditable_amount = tax_amount  si invoice_status = INVOICED y is_tax_deductible = true
                      = 0           en cualquier otro caso
```

Se guarda calculado en lugar de derivarse en cada consulta porque es la columna que los reportes fiscales suman: agregarla en SQL con un `SUM` condicional es una consulta, derivarla en aplicación son N filas cargadas en memoria.

### 9. El saldo de la cuenta se calcula desde movimientos; el capturado a mano se conserva y se contrasta

**Decisión**: `Account` gana `initial_balance`. El reporte de caja calcula:

```
computed_balance = initial_balance + ingresos - gastos pagados - nómina pagada - impuestos pagados
```

y devuelve también `stored_balance` (el `Account.balance` de hoy) y `drift = stored_balance - computed_balance`.

Dos razones para no reemplazar `balance` directamente: el frontend lo lee, y la deriva es información valiosa. Un `drift` de 500 pesos significa que hay un movimiento sin registrar o un monto mal capturado — exactamente lo que un sistema financiero debe hacer visible en vez de resolver por su cuenta.

Alternativa descartada: **mutar `Account.balance` en cada escritura de ingreso/gasto/nómina.** Es lo que haría una app de banca, y aquí sería frágil: cada camino de escritura tendría que acertar el signo y la cuenta, cada corrección tendría que revertir el efecto anterior, y un solo bug deja el saldo mal para siempre sin forma de detectarlo. Calcular desde los movimientos es idempotente por construcción y siempre reconstruible.

`is_active` filtra qué cuentas suman al disponible, y bloquea elegir una cuenta inactiva como cuenta de pago nueva sin invalidar sus movimientos históricos.

### 10. El motor de cálculo es puro; las consultas viven fuera

**Decisión**: `src/reports/profit-engine.service.ts` recibe una estructura de agregados ya calculados y devuelve el reporte. No conoce Prisma. Un servicio separado hace las consultas de agregación y le pasa el resultado.

Es la única forma de probar de verdad la parte que importa. Las pruebas obligatorias son de calendario y de aritmética, no de base de datos: mes completo, mes vacío, cobertura parcial de costo, utilidad negativa, pagos diferidos, denominadores en cero.

Las agregaciones se hacen con `groupBy`/`aggregate` de Prisma, una consulta por bloque (ingresos, gastos por categoría, nómina, impuestos), no cargando filas en memoria. Un mes con miles de movimientos tiene que resolverse en un puñado de consultas.

Los reportes **no se cachean ni se persisten**. Se recalculan siempre. Corregir un gasto de junio tiene que reflejarse en el reporte de junio inmediatamente; el snapshot llega con el cierre mensual en MVP 3, donde es una decisión explícita del usuario y no un efecto secundario de una caché.

### 11. Estimación fiscal: una resta y un porcentaje, con `null` cuando no se sabe

**IVA**: `iva_charged - iva_creditable`, donde `iva_creditable` sólo suma gastos con `invoice_status = INVOICED` e `is_tax_deductible = true`. Negativo → `iva_in_favor`.

**ISR**: `utilidad antes de impuestos × ISR_ESTIMATE_PERCENTAGE`, sobreescribible por petición. **Sin porcentaje configurado, devuelve `null`** — no un valor por defecto inventado. Un ISR estimado con un porcentaje que nadie eligió es peor que no tener ISR estimado, porque parece un dato.

La misma regla aplica a todos los porcentajes del reporte: denominador cero → `null`, nunca `0` ni infinito.

### 12. Estructura de módulos: se repite el patrón, no se inventa

Seis módulos nuevos siguiendo el layout del proyecto (`<name>/<name>.module.ts`, `.controller.ts`, `.service.ts`, `dto/`, `entities/`), reutilizando `src/common/filters`, `src/common/ownership.ts`, `@CurrentUser()` y `@RequirePermissions()`.

Dos piezas rompen el patrón a propósito, porque no son CRUD: `profit-engine.service.ts` y `payroll-schedule.ts` son unidades puras sin controlador.

Todos los DTOs son clases con decoradores de `class-validator`, y todas las respuestas se proyectan con clases de entidad — requisito del CLI plugin de Swagger para que el contrato de `/api-docs/json` no quede vacío. Nada de tipos inline ni `Prisma.*Input` en firmas de controlador.

## Risks / Trade-offs

**La migración `Float → Decimal` toca datos de producción** → Es el riesgo más grave del change. Mitigación: respaldo obligatorio antes de aplicar; la migración se genera con `--create-only` y se revisa el SQL a mano; script de verificación que compara `SUM()` de cada columna monetaria antes y después; se aplica primero en un entorno con copia de los datos reales.

**El frontend se rompe si `Decimal` se serializa como string** → Mitigación: la conversión a número vive en `src/common/money.ts` y se aplica en la proyección de entidad de cada módulo que devuelve dinero. Prueba explícita: `GET /expenses/:id` de un gasto migrado devuelve `89.9` como número, no `"89.90"`.

**Doble conteo de nómina, impuestos o COGS** → El riesgo que más caro sale y menos se nota. Mitigación: tres reglas duras (§3), pruebas unitarias del motor que verifican explícitamente que pagar nómina no altera `operating_expenses` y que compra de inventario no altera `cogs`, y ninguna ruta de código que cree un `Expense` desde `PayrollPayment` o `TaxPayment`.

**COGS sin capturar produce utilidad bruta inflada** → Mitigación: `cost_data_coverage`, `sales_without_cost`, `incomplete_cost_data` y `GET /reports/sales-without-cost` para cerrar el hueco. El reporte declara su propia confiabilidad.

**Base caja desconcierta cuando un pago se atrasa** → Un pago de julio cobrado en agosto aparece en agosto, y a primera vista parece un error. Mitigación: `deferred_payments` en el reporte de nómina, y la doble lectura de periodo fiscal vs caja en impuestos.

**El disponible es incompleto por diseño** → No resta cuentas por pagar porque no existen hasta MVP 3. Mitigación: `excluded_liabilities: ["accounts_payable"]` en la respuesta. La cifra dice qué no incluye en vez de fingir estar completa.

**Rendimiento de los reportes** → Un mes con miles de movimientos y cinco endpoints de reporte, cada uno con varias agregaciones. Mitigación: índices sobre `Expense(paid_at)`, `Expense(category_id)`, `Income(date)`, `Income(income_type)`, `PayrollPayment(scheduled_pay_date)`, `PayrollPayment(paid_at)`, `TaxPayment(paid_at)`, `TaxPayment(fiscal_period_start)`; agregación en SQL, nunca en memoria. Sin caché: si un reporte resulta lento, se optimiza la consulta, no se esconde detrás de un TTL.

**Un mes se puede modificar retroactivamente sin dejar rastro** → Es consecuencia deliberada de "reportes dinámicos" (§10). Lo resuelve el cierre mensual de MVP 3; aquí se acepta.

**El alcance del change es grande** → Cinco modelos nuevos, cuatro modificados, seis módulos, una migración con conversión de tipos. Mitigación: el orden de `tasks.md` es por dependencia y cada bloque queda verificable por su cuenta — esquema y migración, luego permisos, luego los CRUD de insumos, luego los reportes que los consumen. La secuencia permite parar en cualquier bloque con el sistema funcionando.

**`invoiced` y `invoice_status` pueden desincronizarse** → Dos columnas que representan lo mismo siempre pueden divergir. Mitigación: la sincronización ocurre en un único punto del servicio de expenses, con `invoice_status` como fuente de verdad, y hay prueba del caso contradictorio.

## Migration Plan

1. **Respaldo de la base de datos.** No opcional: la migración convierte tipos de columnas con datos.
2. **Esquema en dos partes, una sola migración.** Primero las columnas nuevas y los modelos nuevos (aditivo, sin riesgo); después la conversión `Float → Decimal(14,2)` de las columnas existentes.
3. Generar con `docker exec paldex-api-1 npx prisma migrate dev --create-only` y **revisar el SQL a mano** antes de aplicar, especialmente los `MODIFY COLUMN`.
4. **Backfill en la misma migración**: `Expense.status = 'PAID'`, `paid_at = date`, `invoice_status` derivado de `invoiced`, `is_tax_deductible = true`, `tax_creditable_amount = 0`; `Income.gross_amount = net_amount = amount`, `income_type` derivado de `source`, `channel` derivado de `source`; `Account.initial_balance = balance`, `is_active = true`, `currency = 'MXN'`.
5. **Verificación**: script que compara `SUM()` de cada columna monetaria y el conteo de filas antes y después. Cualquier diferencia distinta de redondeo a dos decimales aborta el despliegue.
6. `npx prisma generate`, `npm run build`, `npm run test`.
7. **Arranque**: la siembra de categorías de sistema y la sincronización del catálogo de permisos corren en `onModuleInit`, ambas idempotentes.
8. **Asignar permisos al rol `user`** si se quiere que alguien distinto de `admin` opere los módulos nuevos — `admin` los recibe automáticamente.
9. **Rollback**: la parte aditiva se revierte borrando columnas y tablas. La conversión `Decimal → Float` es reversible en el tipo pero **no en la precisión**, así que el rollback real es restaurar el respaldo del paso 1. Es la razón por la que el paso 1 no es opcional.
10. **Verificación funcional**: `GET /expenses/:id` de un gasto histórico devuelve el mismo JSON que antes; `GET /reports/monthly` de un mes histórico devuelve cifras coherentes con los datos migrados.

## Open Questions

- **¿Qué porcentaje va en `ISR_ESTIMATE_PERCENTAGE`?** Hasta que se decida, el ISR estimado sale `null`. No bloquea la implementación.
- **¿Los ingresos de Shopify traen ya el desglose de comisiones?** Si `add-shopify-integration` no persiste comisiones de pasarela por transacción, `fee_total` se llenará a mano hasta que exista `add-shopify-profitability`. El motor funciona igual; sólo cambia de dónde sale el dato.
- **¿Se necesita un `Employee` ligado a un `User`?** Hoy `Employee` es independiente: un empleado no es un usuario de la API. Si en el futuro un empleado debe entrar al sistema, hará falta una relación opcional.
- **¿La deriva de saldo debe poder reconciliarse?** El reporte la expone; no hay un endpoint para "aceptar el saldo calculado" y reescribir `Account.balance`. Candidato natural para el cierre mensual de MVP 3.
