## Context

MVP 1 dejó la API capaz de calcular la utilidad real de un mes. MVP 2 la dejó capaz de explicar de dónde sale. Ninguno de los dos convirtió eso en una **operación mensual**, y las cuatro cosas que faltan no son features independientes: son las cuatro consecuencias de una misma decisión pendiente.

Esa decisión es **cuándo un mes deja de cambiar**. MVP 1 eligió deliberadamente reportes dinámicos, sin snapshot ni caché: corregir un gasto de junio reescribe la utilidad de junio, siempre. Es lo correcto mientras junio está en revisión y es un problema en cuanto ese número se usó para decidir algo. De ahí se derivan las otras tres:

- Si un mes se puede cerrar, hace falta saber **qué quedó suelto** antes de cerrarlo — y los gastos fijos olvidados son la fuga más común, porque un gasto que nadie capturó no aparece en ninguna lista de pendientes. De ahí las plantillas recurrentes.
- Si un mes se cierra con un `cash_available` congelado, ese número tiene que ser **verdad**. El de MVP 1 declara `excluded_liabilities: ["accounts_payable"]` porque las cuentas por pagar no existen. Congelar una cifra que se sabe incompleta es peor que no congelar nada.
- Y si hay meses cerrados, **compararlos** es la razón de haberlos cerrado.

Restricciones heredadas que no se negocian:

- **Las fórmulas financieras son de MVP 1.** Este change congela y alinea lo que ya se calcula. Ningún renglón se redefine.
- **El dinero es `Decimal`, la serialización a número JSON vive en `src/common/money.ts`.**
- **No hay scheduler**, y no se añade. La generación de recurrentes es un endpoint idempotente, igual que la nómina.
- **El cálculo de fechas por periodicidad ya existe** en `src/payroll/payroll-schedule.ts`, con la regla de "si el día no existe en el mes, usar el último día". Los gastos recurrentes reutilizan esa unidad; no se escribe una segunda implementación del mismo calendario.

## Goals / Non-Goals

**Goals:**

- Que un gasto fijo olvidado sea imposible: la plantilla lo genera como pendiente y aparece en la lista de pendientes del mes.
- Que `available_cash` sea el dinero que de verdad se puede usar, sin asteriscos.
- Que cerrar un mes congele sus cifras y bloquee las escrituras retroactivas en todos los caminos de la aplicación.
- Y que, cuando el bloqueo falle —porque va a fallar en algún camino, en algún change futuro—, **la divergencia se note**: barata de comprobar, descubierta sola al mes siguiente, y ruidosa en el PR cuando alguien añade un camino nuevo.
- Que reabrir un mes sea posible, deje motivo registrado, y arrastre en cascada los meses posteriores que dependían de él.
- Que comparar meses sea una consulta, y que cada cifra diga si está congelada o puede cambiar mañana.
- Que un CSV se abra bien en Excel en español a la primera.

**Non-Goals:**

- Frontend.
- Redefinir cualquier fórmula financiera.
- Asientos de ajuste sobre meses cerrados. Si algo está mal, se reabre.
- Conciliación bancaria. La deriva de saldo se reporta; no se importan estados de cuenta.
- Notificaciones y recordatorios. El preflight y las listas están en la API; quién avisa es del frontend.
- Scheduler.
- Crédito, intereses y amortización de cuentas por pagar. Un `Payable` es un monto con vencimiento; los intereses son gasto de categoría `DEBT`.
- CFDI, timbrado, facturación electrónica.
- Un motor de renderizado pesado para el PDF.

## Decisions

### 1. Los recurrentes generan gastos `PENDING`, nunca `PAID`

**Decisión**: `POST /recurring-expenses/generate` crea `Expense` en estado `PENDING`. La plantilla recuerda que el gasto existe; que el dinero salió lo confirma una persona.

Es la recomendación explícita del plan de negocio y es correcta por una razón que va más allá de la prudencia: **generar como pagado convierte una plantilla en un hecho financiero**. Un mes en el que nadie tocó nada mostraría la renta pagada, la utilidad reducida y el saldo bajado, todo sin que un peso se moviera. El error resultante es del tipo peor: consistente, invisible y acumulativo.

Generando como pendiente, el peor caso es un gasto pendiente que nadie confirmó — que aparece en `fixed_expenses_pending`, en la proyección y en el preflight del cierre. Visible en tres lugares.

**El monto del gasto generado es editable sin tocar la plantilla**, en ambas direcciones: el internet de 700 se paga por 740 y la plantilla sigue en 700; la plantilla sube a 8500 y los gastos ya generados siguen en 8000. Plantilla y gasto son objetos distintos con vidas distintas.

Idempotencia por índice único `(recurring_expense_id, scheduled_due_date)`, la misma técnica que la nómina: se genera y las colisiones se ignoran, sin razonar sobre "¿ya generé este mes?".

### 2. Los recurrentes reutilizan el calendario de la nómina

**Decisión**: extraer el cálculo de fechas por periodicidad a una unidad compartida y usarla desde nómina y desde recurrentes.

Son el mismo problema: dada una periodicidad, una configuración de día y un rango, ¿qué fechas caen dentro? Con la misma regla de calendario, incluido el mismo caso raro (día 31 en abril → 30 de abril). Dos implementaciones del mismo calendario divergirían en los bordes, y los bordes son justo donde estos cálculos se rompen.

`YEARLY` es el único caso que la nómina no tiene, así que se añade a la unidad compartida en lugar de justificar una segunda implementación.

### 3. `paid_amount` y `status` de un `Payable` son derivados, no capturados

**Decisión**: los abonos son filas (`PayablePayment`); `paid_amount` es su suma y `status` se deriva del saldo. El cliente no puede enviar ninguno de los dos.

Un `paid_amount` capturable es un campo que se desincroniza: alguien registra un abono y olvida actualizar el total, o lo actualiza dos veces. Derivándolo de las filas, el saldo siempre cuadra con los abonos porque no hay otra forma de que exista.

**`OVERDUE` no se persiste, se calcula al consultar.** Un estado de vencimiento almacenado queda obsoleto al día siguiente y necesitaría un cron para mantenerse — que no existe, y no debería existir para esto. Comparar `due_date` contra hoy en tiempo de consulta siempre está al día.

Y un abono no puede exceder el saldo pendiente: `400` con el saldo disponible en el mensaje. Sin esa validación, `status` podría quedar en `PAID` con `paid_amount` mayor que el total, y el disponible se distorsionaría a favor.

### 4. Las cuentas por cobrar no son ingreso

**Decisión**: `Receivable` es simétrico a `Payable`, y **no cuenta como ingreso**. El ingreso se registra cuando el dinero entra, vía `Income`. En el reporte de caja, `receivables_outstanding` es informativo y **no suma** al disponible.

Es la asimetría deliberada del diseño. Una cuenta por pagar es dinero que ya no es tuyo aunque siga en la cuenta: restarlo del disponible es prudente y correcto. Una cuenta por cobrar es dinero que podría no llegar: sumarlo al disponible sería contar con dinero que no está. La asimetría es la postura conservadora, y en una herramienta cuyo propósito es decidir cuánto se puede gastar, es la única defendible.

### 5. El cierre es un snapshot, y la guardia es un punto único

**Decisión**: `POST /monthly-close/:year/:month/close` calcula el estado mensual y lo persiste. Desde ese momento, `GET /reports/monthly` de ese periodo devuelve el snapshot con `source: 'SNAPSHOT'`, y las escrituras con fecha en el periodo devuelven `409`.

La guardia vive en **un solo lugar**: `src/monthly-close/close-guard.ts`, con una función que responde "¿esta fecha cae en un mes cerrado de este usuario?". Se invoca desde los servicios de expenses, incomes, payroll, tax-payments, la generación de recurrentes, la escritura de `CostOfGoodsSold` y —si MVP 2 está aplicado— la recalculación de costos.

Es el riesgo central de este change y conviene nombrarlo sin adornos: **un camino de escritura sin guardia hace que el snapshot y los datos divergan en silencio**, y un cierre que no cierra es peor que no tener cierre, porque genera confianza injustificada. De ahí que la guardia sea una unidad sola y no una comprobación copiada en cada servicio — y de ahí, sobre todo, la decisión §12: la guardia no se sostiene sola.

Un mes sin registro de cierre se trata como `OPEN`. No hace falta crear filas para operar; el registro nace cuando alguien lo marca en revisión o lo cierra.

**Sólo `CLOSED` bloquea.** `REVIEWING` es una señal para las personas, no un candado: bloquear durante la revisión impediría justamente las correcciones que la revisión encuentra.

### 6. La fecha relevante de la guardia es la fecha del dinero

**Decisión**: la guardia mira `paid_at` cuando existe, y `date` en caso contrario. Para nómina, `paid_at` o `scheduled_pay_date`. Para impuestos, `paid_at`.

De ahí sale un comportamiento que parece una excepción y es la regla bien aplicada: **pagar hoy un gasto cuya `date` cae en un mes cerrado está permitido.** La salida de dinero ocurre hoy, en el mes abierto, y es hoy donde cuenta en base caja. Bloquearlo obligaría a reabrir un mes cerrado para pagar una factura atrasada, que es exactamente el trabajo que el cierre debería evitar.

### 7. Cerrar exige orden; reabrir arrastra en cascada

**Decisión**: un mes no se cierra si el anterior tiene datos y sigue abierto. Reabrir un mes reabre automáticamente los posteriores cerrados.

`cash_available` de agosto depende del saldo acumulado hasta julio. Si julio se reabre y cambia, el snapshot de agosto queda apoyado en cifras que ya no existen. La cascada es la única forma de que un snapshot cerrado signifique algo.

Es agresivo, y la alternativa es peor: dejar agosto cerrado con un saldo inicial que ya no corresponde. La respuesta de reapertura informa qué meses arrastró.

**La reapertura exige `reason` no vacío**, y el snapshot anterior **se conserva** marcado como perteneciente a un cierre revertido. Reabrir es una decisión con historia, no un clic; y saber qué decía el número antes de reabrir es lo que permite explicar por qué cambió.

### 8. Cerrar con pendientes se permite; ignorarlos, no

**Decisión**: el preflight separa `warnings` de `blocking_issues`. Los pendientes —gastos, nómina, impuestos, ventas sin costo, facturas por recibir, deriva de saldo, cuentas vencidas— son **warnings**. Sólo bloquean dos cosas: que el mes anterior esté abierto, y que el mes sea futuro.

Un cierre que exige cero pendientes no se usa: en la práctica hay siempre una factura por llegar, y el mes se queda abierto para siempre. El diseño correcto es que el usuario **vea** lo que deja suelto y decida. Cerrar con pendientes es una decisión legítima; cerrar sin saberlos, no.

### 9. Las series leen snapshots y agregan por mes en SQL

**Decisión**: `GET /reports/trends?months=36` agrupa por mes en SQL para los periodos abiertos y **lee el snapshot** de los cerrados. No ejecuta el reporte mensual 36 veces.

La implementación ingenua —un bucle llamando al reporte mensual— hace 36 × N consultas y crece linealmente con el rango. Como la mayoría de los meses de una serie larga van a estar cerrados, leerlos de su snapshot resuelve casi toda la serie con una consulta a `MonthlyClose`.

Los meses sin datos aparecen en la serie con ceros y márgenes `null`, no se omiten: una serie con huecos silenciosos se grafica como si esos meses no existieran.

Y cada punto declara su `source`, con `has_mixed_sources` en la comparación. Comparar un mes cerrado con uno abierto es legítimo; no poder distinguirlos, no.

### 10. CSV con UTF-8 BOM y coma por defecto

**Decisión**: `src/common/csv.ts` genera UTF-8 **con BOM**, separador configurable (`,` por defecto, `;` disponible), escapado por comillas dobles con duplicación interna, montos con punto decimal y dos decimales sin símbolo ni separador de miles, fechas ISO, nulos como celda vacía.

El BOM es el detalle que decide si el archivo sirve. Sin él, Excel en Windows interpreta UTF-8 como Latin-1 y "Compra de mercancía" se ve corrupto — el archivo es técnicamente correcto e inservible para su único destino real.

Coma por defecto en lugar de punto y coma: es lo que espera cualquier otro consumidor (Sheets, pandas, importadores), y `delimiter=;` está ahí para el Excel configurado en español que trata la coma como decimal.

**La exportación no pagina**, y por eso **exige rango de fechas** con un máximo de 24 meses. Sin ese límite, `GET /expenses/export` sin filtros es una consulta sin techo.

### 11. PDF sólo si es ligero; si no, `501` honesto

**Decisión**: se implementa el PDF con una biblioteca ligera de generación. Si no existe una opción viable, el endpoint devuelve `501 Not Implemented` señalando que CSV sí está disponible.

Meter un navegador headless en la API por un reporte mensual es desproporcionado: multiplica la imagen de Docker, añade una superficie de seguridad considerable y un proceso hijo que puede colgarse. Un `501` explícito con la alternativa a mano es mejor que un PDF que llega a costa de eso, y mucho mejor que un archivo vacío o corrupto.

### 12. Detección barata y certera, antes que prevención perfecta

La guardia de §5 es necesaria y **no es suficiente**. Conviene ser preciso sobre por qué: hoy el repo tiene 6 escrituras financieras (`expenses` ×3, `incomes` ×3); con los tres MVPs aplicados son ~22, y siguen creciendo con cada change futuro. La prevención por invocación tiene tres huecos que ninguna disciplina cierra: **no cubre `$queryRaw`**, **no cubre scripts y migraciones**, y **no cubre a nadie tocando la base a mano**. Y lo peor: un camino olvidado no rompe ninguna prueba ni emite ningún log. El síntoma llega meses después, y en ese momento nadie puede reconstruir cuál de los dos números era el bueno.

**Decisión**: no perseguir una prevención hermética. Hacer que la divergencia sea **detectable con certeza y barata de comprobar**, y que se descubra sola.

Tres mecanismos, continuos los tres:

1. **Huella de insumos en el snapshot.** Al cerrar, `MonthlyClose` guarda —además de los siete totales— el conteo de filas y la suma monetaria de cada tabla de origen del periodo. Cualquier escritura que se cuele cambia un conteo o una suma. `GET /monthly-close/:y/:m/integrity` compara y responde `OK` o `DIVERGED` señalando la tabla. Cuesta una agregación por tabla, no recalcular el reporte.

2. **El preflight del mes siguiente comprueba el mes anterior.** Es el mecanismo que convierte la mitigación en continua: nadie tiene que acordarse de llamar al endpoint de integridad, porque cerrar agosto obliga a verificar julio. Un hueco en la guardia tiene una ventana de descubrimiento de un mes, automática.

3. **Test de lista blanca de caminos de escritura.** Una prueba escanea `src/` buscando escrituras de Prisma sobre los modelos financieros y exige que cada archivo esté en una lista explícita **y** que referencie la guardia. Es el único de los tres que actúa en tiempo de desarrollo: añadir un módulo que escriba gastos rompe el PR.

Dos detalles de correctitud que no son opcionales:

- **Las sumas de la huella se guardan como cadena decimal**, no como número JSON. Una huella que existe para detectar diferencias exactas no puede pasar por punto flotante.
- **La huella lleva `fingerprint_version`.** Cuando la definición cambie —al añadir las líneas de Shopify de MVP 2, por ejemplo— la versión se incrementa, y una huella de versión distinta se reporta como **no comparable**, no como divergente. Sin eso, ampliar la huella marcaría de golpe todos los meses cerrados como corruptos.

Y una honestidad necesaria sobre el alcance del test de lista blanca: **no demuestra que la guardia se invoque en cada rama.** Estar en la lista y referenciar la guardia no prueba que se llame siempre. Su valor es que la omisión se vuelve una decisión consciente y falla en el PR, no que garantice cobertura.

**La divergencia del mes anterior bloquea el cierre**, y es la única excepción a §8 (los pendientes no bloquean). Está justificada: `cash_available` de agosto se apoya en el saldo acumulado hasta julio, así que no hay cierre coherente encima de un julio cuyos números se movieron. Las salidas son reabrir y recerrar, o aceptar y recerrar — ambas explícitas.

**Alternativa descartada: extensión de Prisma Client (`$extends`).** Está disponible en la versión instalada (7.9.1, verificado en el cliente generado) e interceptaría las escrituras por modelo, haciendo la guardia imposible de olvidar en el call site. Se descarta por el balance: en `update` y `delete` la extensión sólo ve el `where`, no la fecha de la fila, así que haría falta **leer la fila antes de cada escritura**; el dueño del mes cerrado exige contexto de petición vía `AsyncLocalStorage` sobre un `PrismaService` que es singleton; y haría falta una escotilla para migraciones, seeds y scripts. Todo eso compra prevención en el call site **y sigue sin cubrir `$queryRaw` ni las escrituras externas**, que es exactamente por donde se cuela lo que más duele. La huella cubre los tres huecos por cuatro agregaciones y sin tocar ninguna ruta de escritura.

**Alternativa anotada, no descartada: no bloquear, inmutabilizar.** Eliminar la guardia, dejar que la escritura sobre un mes cerrado se permita, y que el reporte muestre `post_close_adjustments` aparte del snapshot. No hay nada que olvidar porque no hay nada que prevenir, y es más cercano a cómo funciona la contabilidad real: no se prohíbe el asiento, se registra donde corresponde. Choca con el non-goal de "sin asientos de ajuste" y con la expectativa de que un mes cerrado no se toca, así que no entra aquí. Queda como la evolución natural si el bloqueo estorba en la práctica — lo cual es probable la primera vez que haya que reabrir tres meses en cascada para corregir una factura. Es compatible con la huella: la detección sigue siendo útil sin la guardia.

## Risks / Trade-offs

**Un camino de escritura sin guardia de mes cerrado** → Sigue siendo el riesgo más grave, y la prevención completa no es alcanzable (§12): la guardia no cubre `$queryRaw`, scripts, ni escrituras externas. Mitigación, en tres capas continuas en vez de una auditoría puntual: la huella de insumos hace la divergencia detectable con una agregación por tabla; el preflight del mes siguiente la descubre sin que nadie la busque y bloquea el cierre; y el test de lista blanca hace fallar el PR cuando aparece un camino nuevo. Más, por una vez, la auditoría de la lista del paso 1.3 y un `409` probado por endpoint. Lo que estas capas garantizan no es que no haya huecos, sino que un hueco se note en semanas y no en años.

**El test de lista blanca da falsa sensación de cobertura** → Comprueba que el archivo está autorizado y menciona la guardia, no que la invoque en cada rama. Mitigación: documentarlo así en el propio test y en `CLAUDE.md`, para que nadie lo lea como una demostración.

**Ampliar la huella marcaría todos los meses como divergentes** → Mitigación: `fingerprint_version`; una versión distinta se reporta como no comparable, nunca como divergencia.

**El bloqueo por divergencia puede dejar el cierre atascado** → Un mes divergente impide cerrar el siguiente hasta resolverlo. Mitigación: las dos salidas son explícitas y están en la spec —reabrir y recerrar, o recerrar aceptando las cifras nuevas—; el preflight nombra la tabla afectada para que la resolución no sea a ciegas.

**La cascada de reapertura sorprende** → Reabrir julio reabre agosto y septiembre. Mitigación: la respuesta informa qué meses arrastró; el preflight lo anticipa; los snapshots anteriores se conservan.

**Órdenes de Shopify que llegan con fecha en un mes cerrado** → La sincronización es asíncrona y no controla cuándo llega un webhook. Mitigación: la orden no altera el mes cerrado y queda en un reporte de conflictos para que alguien decida — reabrir, o registrar el ajuste en el mes abierto. Fallar el webhook sería peor: Shopify reintentaría indefinidamente.

**Gastos recurrentes pendientes que nadie confirma** → Se acumulan y distorsionan la proyección. Mitigación: aparecen en `fixed_expenses_pending`, en `GET /reports/upcoming-payments` y en el preflight del cierre. Tres lugares donde se ven.

**`OVERDUE` calculado en cada consulta** → Cuesta una comparación de fecha por fila. Mitigación: es más barato que mantener un estado persistido al día, y no puede quedar obsoleto.

**Duplicación conceptual entre `Payable` y `Expense`** → Una compra a crédito puede registrarse como cuenta por pagar y también como gasto pendiente, y contarse dos veces. Mitigación: la regla es que un `Payable` **no** es un gasto; el gasto se registra cuando se paga, y los abonos del `Payable` son el rastro de esos pagos. Documentado en `CLAUDE.md` y con prueba explícita de que un `Payable` pendiente no aparece en ningún renglón de gasto del reporte.

**El PDF puede no llegar** → Mitigación: `501` honesto con CSV disponible, y la limitación documentada. No se degrada la API por cumplir con el formato.

**Exportaciones grandes** → Mitigación: rango obligatorio, máximo 24 meses, escritura por streaming en lugar de materializar la cadena completa en memoria.

**El límite de 24 meses puede estorbar** → Alguien querrá exportar tres años para el contador. Mitigación: se exporta en dos peticiones. Es una restricción consciente frente a una consulta sin techo.

## Migration Plan

1. **Requisito previo**: `add-financial-model-core` aplicado. `add-shopify-profitability` es opcional; si está, la guardia también cubre la recalculación de costos.
2. Respaldo de la base de datos.
3. Migración **casi aditiva**: seis modelos nuevos más tres columnas en `Expense` (`recurring_expense_id`, `scheduled_due_date`, `is_recurring`). No modifica ninguna columna existente ni convierte tipos.
4. **Backfill**: `is_recurring = false` en todos los gastos existentes; `recurring_expense_id` y `scheduled_due_date` en `NULL`.
5. Generar con `--create-only`, revisar el SQL, aplicar. `npx prisma generate`, `npm run build`, `npm run test`.
6. Añadir al catálogo los permisos `recurring_expense`, `payable`, `receivable` y `monthly_close`; se sincronizan al arrancar.
7. **Extraer el calendario compartido** de `payroll-schedule.ts` y verificar que las pruebas de nómina de MVP 1 siguen pasando sin cambios. Si alguna se rompe, la extracción alteró comportamiento y hay que corregirla antes de seguir.
8. **Desplegar la guardia de cierre antes de habilitar el cierre.** Con cero meses cerrados la guardia no rechaza nada, así que se puede verificar en producción sin impacto: ningún `409` debe aparecer mientras no exista un `MonthlyClose` en `CLOSED`.
9. **Auditoría de caminos de escritura**: recorrer expenses, incomes, payroll, tax-payments, cogs, recurring-expenses y —si aplica— la recalculación de MVP 2, confirmando que cada uno invoca la guardia. Sembrar la lista blanca del test con el resultado de esta auditoría: de aquí en adelante, la lista la mantiene el test, no una revisión manual.
10. **Primer cierre de prueba** sobre un mes histórico: ejecutar el preflight, cerrar, verificar que `GET /reports/monthly` devuelve el snapshot con las mismas cifras que devolvía dinámicamente, y que una escritura sobre ese mes devuelve `409`.
11. **Verificar la detección de extremo a extremo**: comprobar que `GET /monthly-close/:y/:m/integrity` responde `OK`; modificar a propósito una fila de ese mes por SQL directo, confirmar que pasa a `DIVERGED` nombrando la tabla, y que el preflight del mes siguiente lo reporta como `blocking_issue`; deshacer el cambio y confirmar que vuelve a `OK`. Es la prueba de que la red de seguridad existe, y hay que hacerla una vez a mano.
12. **Reapertura de prueba**: reabrir con motivo, verificar la cascada, que el reporte vuelve a ser dinámico, y que al recerrar la huella se recalcula.
13. Crear las plantillas de gasto recurrente y ejecutar `POST /recurring-expenses/generate` del mes en curso.
14. **Rollback**: la migración se revierte borrando las seis tablas y las tres columnas de `Expense`. Ningún dato de MVP 1 o 2 se pierde. La guardia deja de aplicarse al no haber tabla de cierres.

## Open Questions

- **¿Cuál es la biblioteca de PDF viable?** Determina si el endpoint responde con un archivo o con `501`. No bloquea el resto del change.
- **¿Debe el cierre reconciliar la deriva de saldo?** El preflight la reporta; el cierre no escribe `Account.balance` con el valor calculado. Es la pregunta que MVP 1 dejó abierta y este change tampoco resuelve — hacerlo convertiría el cierre en una operación que muta datos, no sólo que los congela.
- **¿Un `Payable` debería poder generar el `Expense` al liquidarse?** Hoy son independientes y la regla anti-duplicación depende de que la persona no capture ambos. Automatizarlo sería más seguro y requiere decidir qué categoría lleva el gasto generado.
- **¿Cierres por usuario o globales?** El diseño usa `@@unique([user_id, year, month])`, coherente con el alcance `OWN` del proyecto. Si Corszas opera como una sola entidad con varios usuarios, un cierre global tendría más sentido — pero eso choca con el modelo de propiedad de datos vigente.
- **¿Qué pasa con las órdenes de Shopify en el reporte de conflictos?** El change las registra; no define quién las revisa ni con qué frecuencia. Es un asunto de proceso, no de API.
