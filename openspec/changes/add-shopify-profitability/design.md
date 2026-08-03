## Context

`add-shopify-integration` dejó el desglose financiero de cada pedido en `ShopifyOrder`, incluido `line_items` como **columna JSON** y unos totales agregados (`cost_total`, `profit_total`, `has_missing_cost_data`). `add-financial-model-core` construyó encima el estado de resultados mensual, con el costo de mercancía capturado por venta vía `CostOfGoodsSold`.

Ese diseño responde "cuánto ganamos". Se rompe en cuanto la pregunta es "en qué":

- **El JSON no se puede agrupar.** MySQL puede extraer campos de un JSON, pero agrupar por `product_type` y sumar utilidades a lo largo de 20 000 líneas de un mes vía `JSON_EXTRACT` es una consulta que no se puede indexar. La alternativa —cargar las órdenes y agrupar en Node— es peor: memoria proporcional al volumen de ventas y aritmética de dinero fuera de SQL.
- **El costo por venta no escala.** `CostOfGoodsSold` liga costo a un `Income`. Si el mismo ETB se vende cuarenta veces, hay que capturar cuarenta filas de costo con el mismo número. Nadie lo hace, la cobertura se queda baja, y el reporte de rentabilidad nace incompleto.

Restricciones que este change hereda y no negocia:

- **No se toca la sincronización.** Webhooks, OAuth, backfill y reconciliación son de `add-shopify-integration`. Este change añade un paso **después** de que una orden se persiste.
- **Shopify no guarda histórico de costo.** `InventoryItem.unitCost` es el costo *actual*. Por eso el costo de una orden se congela al sincronizar, y por eso el catálogo de costos de este change necesita vigencia por fecha propia.
- **El dinero es `Decimal`.** MVP 1 estableció la regla; aquí se respeta, incluidas las columnas nuevas y la serialización a número JSON en la frontera.
- **`Account.balance` no se toca.** Este change no mueve dinero, sólo lo explica.

## Goals / Non-Goals

**Goals:**

- Que "¿qué categoría deja más dinero real?" sea una consulta SQL agrupada, no un recorrido en memoria.
- Que capturar el costo de un producto **una vez** baste para todas sus ventas, pasadas y futuras.
- Que un costo capturado tarde arregle el histórico, en vez de dejarlo mal para siempre.
- Que el reporte distinga "esta categoría deja más pesos" de "esta categoría deja mejor margen", porque son decisiones distintas.
- Que la falta de costo se mida y se declare, nunca se rellene con ceros.
- Que cambiar el costo de un producto hoy no reescriba la utilidad de un mes ya reportado.

**Non-Goals:**

- Frontend.
- Cambiar el flujo de sincronización de Shopify.
- Leer costos desde la GraphQL Admin API. El modelo admite `source: SHOPIFY_INVENTORY`; traer el dato queda para después.
- Inventario, existencias, costo promedio ponderado.
- Modelar colecciones de Shopify como entidad. Se resuelven a un nombre de categoría al proyectar.
- Repartir envío y comisiones entre líneas. La utilidad por línea es ventas netas de línea menos costo de línea; lo demás vive a nivel de orden.
- Cambiar las fórmulas del estado mensual. Mejoran solas porque mejora la cobertura de costo.
- Cierre mensual, comparación de periodos, exportaciones → `add-monthly-operations`.

## Decisions

### 1. Las líneas se normalizan a filas; el JSON se queda como evidencia

**Decisión**: nueva tabla `ShopifyLineItem`, una fila por producto vendido. `ShopifyOrder.line_items` se conserva sin cambios, como snapshot crudo de lo que Shopify devolvió.

Guardar los dos es redundancia deliberada. El JSON es la evidencia de qué contestó Shopify aquel día: si mañana se descubre que la proyección interpretaba mal un campo, se reproyecta desde el JSON sin volver a llamar a la API — que para órdenes viejas puede ser imposible, porque el catálogo cambió. El JSON es la fuente; las filas son el índice.

Regla operativa: **ninguna consulta de reporte lee el JSON.** Si aparece un `JSON_EXTRACT` en un endpoint de rentabilidad, el diseño se rompió.

Alternativas descartadas:

- **Consultar el JSON con `JSON_TABLE`/`JSON_EXTRACT`.** Cero migración y cero backfill, y una consulta que no se puede indexar por categoría ni por SKU. El primer mes con volumen real la vuelve inservible.
- **Sustituir el JSON por las filas.** Ahorra espacio y destruye la capacidad de reproyectar. El espacio no es el problema aquí.

`@@unique([shopify_order_id, shopify_line_item_id])` hace la proyección idempotente sin lógica de "¿ya proyecté esto?".

### 2. La proyección es transaccional con la escritura de la orden

**Decisión**: después de persistir o actualizar una `ShopifyOrder`, la sincronización proyecta sus líneas **en la misma transacción**.

Sin eso existe un estado intermedio —orden persistida, líneas no— en el que el reporte de rentabilidad devuelve cifras que no cuadran con el estado mensual. Con webhooks que pueden llegar duplicados o fuera de orden, ese estado no es teórico. Si la proyección falla, la orden no se guarda; el webhook se reintenta y la reconciliación diaria la recupera.

Y la contrapartida que hay que aceptar: **si el JSON de una orden nueva es ilegible, la orden no entra.** Es lo correcto — una orden sin líneas es peor que una orden ausente, porque contamina el reporte silenciosamente. El backfill de órdenes históricas se comporta al revés (§5), por razones distintas.

Una línea que desaparece del JSON tras una actualización de orden se **borra** como fila. Sin eso, una orden editada en Shopify dejaría un producto fantasma sumando utilidad para siempre.

### 3. Categoría por cadena de precedencia, con el origen guardado

**Decisión**: la categoría se resuelve en este orden — override manual → `product_type` → primera colección → primer tag → `UNKNOWN` — y la fila guarda **cuál eslabón ganó** en `category_source`.

Guardar el origen es lo que hace el reporte defendible. Ver que una categoría vino de `TAG` explica por qué se llama raro; ver que vino de `MANUAL` explica por qué no coincide con Shopify. Sin ese campo, un nombre de categoría es un dato sin procedencia.

Un `product_type` vacío no cuenta como valor: cadena vacía significa "no configurado", y tratarla como categoría produce un renglón sin nombre que nadie puede interpretar.

El resolvedor es una **función pura** en `src/shopify/category-resolver.ts`. Recibe los datos del producto y el override, devuelve `{ name, source }`. Es la clase de lógica que se rompe en los casos raros —campos vacíos, arreglos vacíos, acentos, mayúsculas— y una función pura los prueba todos sin base de datos.

Alternativa descartada: **una sola fuente configurable globalmente** ("usa `product_type` para todo"). Más simple, y falla en cuanto un producto no tiene ese campo: cae a `UNKNOWN` teniendo un tag perfectamente bueno.

Alternativa descartada: **resolver la categoría al consultar el reporte, no al proyectar.** Permite cambiar de estrategia sin reproyectar, y hace imposible indexar por categoría — que es justo lo que este change necesita.

### 4. `ProductCost` con vigencia por fecha, y precedencia explícita

**Decisión**: catálogo `ProductCost` con `unit_cost` y `effective_from`, resoluble por `shopify_variant_id` o por `sku`. El costo aplicable a una orden es el registro con `effective_from` más reciente **anterior o igual** a la fecha de la orden.

Por qué vigencia y no un costo único por producto: el costo cambia. Si un ETB costaba 800 en junio y 900 en agosto, aplicar 900 a las ventas de junio reescribe la utilidad de un mes ya reportado. Un solo campo de costo hace ese error inevitable; la vigencia lo hace imposible.

Y la regla que suele olvidarse: **un costo con vigencia futura no aplica.** Si el único costo registrado empieza el 1 de agosto y la orden es de julio, la línea queda sin costo. Usar ese costo "porque es el único que hay" es exactamente el tipo de relleno silencioso que este diseño evita.

Precedencia de resolución: costo congelado en la línea → `ProductCost` por variante → `ProductCost` por SKU → sin costo. La variante gana porque es más específica: dos variantes del mismo producto pueden costar distinto. El SKU existe como red porque no todas las tiendas mantienen variantes limpias.

En `src/shopify/cost-resolver.ts`, función pura, por la misma razón que el resolvedor de categoría.

### 5. El backfill tolera lo ilegible; la sincronización no

**Decisión**: `scripts/backfill-line-items.ts` reproyecta las órdenes existentes desde su JSON, por lotes, **sin llamar a Shopify**. Una orden ilegible se registra con su identificador y el lote continúa.

Es la política opuesta a la de §2, a propósito. En sincronización, rechazar una orden ilegible es correcto: el webhook se reintenta. En backfill, abortar el lote completo por una orden vieja con formato raro significa que 499 órdenes buenas se quedan sin proyectar por una mala. Y omitirla en silencio es peor que las dos: el reporte queda incompleto sin que nadie se entere.

El punto medio —procesar todo, registrar lo que falló, informar el conteo— es el único que deja al operador decidir qué hacer con los casos raros.

### 6. La recalculación es explícita, idempotente y con aviso pendiente

**Decisión**: `POST /shopify/recalculate-costs?start_date&end_date` reresuelve costo y utilidad de las líneas del periodo y propaga a órdenes e ingresos. Capturar un `ProductCost` o un override **no** reescribe nada por sí solo.

Tres razones para no recalcular automáticamente al capturar un costo. Una escritura de costo puede afectar miles de líneas de años distintos, y una petición HTTP no es el lugar para eso. Reescribir la utilidad de un mes ya revisado como efecto colateral de teclear un costo es sorprendente en el peor sentido. Y el cierre mensual de MVP 3 va a querer bloquear justamente esas reescrituras — un recálculo explícito es algo que se puede bloquear; un efecto colateral, no.

La contrapartida es un reporte que puede estar desactualizado sin avisar. Se resuelve con `pending_cost_updates`: si existen `ProductCost` u overrides creados después de la última recalculación del periodo, el reporte lo dice. El número no está mal — está pendiente, y lo declara.

Idempotencia: la recalculación deriva todo de los datos vigentes, no acumula. Ejecutarla dos veces da el mismo resultado.

### 7. La cobertura de costo se mide en el reporte, no se esconde

**Decisión**: cada respuesta de rentabilidad incluye `cost_data_quality` con `total_line_items`, `line_items_with_cost`, `missing_cost_items`, `sales_without_cost`, `cost_data_coverage`, `gross_profit_confirmed` y `pending_cost_updates`.

Es la misma decisión de MVP 1 aplicada aquí: `null` significa "no sé", `0` significa "no costó nada". Una categoría sin costos capturados devuelve `gross_margin_percentage: null` e `incomplete_cost_data: true`, y sus ventas siguen apareciendo completas. Ocultar la venta por falta de costo falsearía el ranking de ventas; contar su costo como cero falsearía el de utilidad.

Y `GET /product-costs/missing` ordenado por **ventas netas descendente**: la lista de trabajo empieza por lo que más se vendió, porque capturar ese costo es lo que más sube la confiabilidad por unidad de esfuerzo.

### 8. Carga masiva todo-o-nada

**Decisión**: `POST /product-costs/bulk` valida el lote completo antes de escribir. Una entrada inválida devuelve `400` con el índice y el motivo de cada error, y no crea ninguna.

La alternativa —crear las válidas e informar las que fallaron— deja al usuario con un estado parcial que tiene que reconciliar a mano contra su archivo original. Con un lote de 40 líneas donde falló la 12, "todo o nada" significa arreglar la 12 y reenviar; "parcial" significa averiguar qué entró.

### 9. Utilidad bruta y margen se exponen por separado, siempre

**Decisión**: el reporte ordena por utilidad bruta por defecto, y expone `top_by_gross_profit` y `top_by_margin` como campos distintos incluso cuando apuntan a la misma categoría.

Es el punto del reporte. Una categoría que vende 100 000 y deja 10 000 es peor negocio que una que vende 40 000 y deja 18 000, y cualquier ranking único obliga a elegir qué pregunta contestar. Contestando las dos, la decisión —qué comprar más, qué dejar de priorizar— la toma quien tiene el contexto.

Detalle de ordenación que importa: al ordenar por margen descendente, las categorías con margen `null` van **al final**. En SQL, `NULL DESC` las pondría primero, y el reporte abriría con las categorías de las que menos se sabe.

### 10. Agregación en SQL, una consulta por bloque, sin caché

**Decisión**: los reportes se calculan con `groupBy`/`aggregate` de Prisma sobre `ShopifyLineItem`, con índices en `category_name`, `sku` y `shopify_variant_id`. Nada de cargar líneas en memoria. Nada de caché.

`order_count` necesita un `COUNT(DISTINCT shopify_order_id)` por categoría — no es `COUNT(*)` de líneas. Es un error fácil de cometer y produce un número que parece razonable y está mal.

Sin caché, por la misma razón que en MVP 1: corregir un costo y volver a consultar tiene que reflejarse de inmediato. El snapshot llega con el cierre mensual, como decisión explícita del usuario.

## Risks / Trade-offs

**El backfill reproyecta JSON histórico de formato posiblemente variable** → Es el riesgo principal. Mitigación: proyección tolerante campo por campo, registro de órdenes ilegibles con identificador, ejecución por lotes, informe final con conteo de fallos. Se ejecuta primero contra una copia de los datos reales y se revisa el informe antes de correrlo en producción.

**Doble fuente de costo: `CostOfGoodsSold` de MVP 1 y `ProductCost` de este change** → Riesgo real de contar el costo dos veces. Mitigación: para líneas de Shopify, el costo lo resuelve `ProductCost` y se propaga a `Income.cogs_total`; `CostOfGoodsSold` queda para ingresos que **no** vienen de Shopify. La propagación **escribe** `cogs_total`, no le suma. Prueba explícita: una orden con costo resuelto y un `CostOfGoodsSold` manual sobre el mismo ingreso no produce el doble de COGS.

**La proyección transaccional puede rechazar órdenes nuevas** → Un cambio de formato en la API de Shopify empezaría a rechazar órdenes en vez de guardarlas a medias. Mitigación: es el comportamiento deseado, y hace el fallo ruidoso en lugar de silencioso; los reintentos de webhook y la reconciliación diaria dan margen para desplegar un arreglo.

**Un reporte puede estar desactualizado respecto a los costos capturados** → Consecuencia de la recalculación explícita (§6). Mitigación: `pending_cost_updates` en la respuesta.

**Rendimiento de la agregación con volumen alto** → Mitigación: índices en `category_name`, `sku`, `shopify_variant_id`; agregación en SQL; paginación en el reporte por producto. El reporte por categoría no se pagina porque el número de categorías es acotado por naturaleza.

**La categoría es texto, no una entidad** → Un cambio de nombre en Shopify crea una categoría nueva en el reporte, y el histórico queda partido en dos renglones. Mitigación: los overrides manuales permiten unificar, y la reproyección aplica el nombre unificado. Modelar categorías como entidad es una opción futura, no necesaria para responder la pregunta de este change.

**`profit_share_percentage` con utilidad total negativa** → Si el periodo cierra con utilidad bruta negativa, las participaciones porcentuales dejan de tener sentido. Mitigación: cuando la utilidad bruta total es cero o negativa, `profit_share_percentage` es `null`.

## Migration Plan

1. **Requisito previo**: `add-financial-model-core` aplicado — este change usa `Income.cogs_total`, `Income.profit_gross`, `src/common/money.ts` y el permiso `report:read`.
2. Respaldo de la base de datos.
3. Migración **puramente aditiva**: `ShopifyLineItem`, `ProductCost`, `ProductCategoryOverride`, sus índices. No modifica ninguna columna existente.
4. Generar con `--create-only` y revisar el SQL.
5. `npx prisma generate`, `npm run build`, `npm run test`.
6. Añadir los permisos `product_cost` y `product_category_override` al catálogo; se sincronizan en el arranque.
7. **Backfill en seco**: ejecutar `scripts/backfill-line-items.ts` con `--dry-run` contra una copia de los datos reales y revisar el informe de órdenes ilegibles.
8. **Backfill real** por lotes, revisando el informe final.
9. **Verificación de coherencia**: para un periodo con datos, la suma de `net_sales` de las líneas debe coincidir con `items_total` menos descuentos de sus órdenes. Cualquier desviación sistemática indica que la proyección interpreta mal un campo.
10. Cargar costos con `POST /product-costs/bulk`, empezando por la lista de `GET /product-costs/missing`.
11. Ejecutar `POST /shopify/recalculate-costs` sobre los periodos que se quieran reportar.
12. **Verificación final**: `GET /reports/monthly` del mismo periodo muestra `cost_data_coverage` mayor que antes, con las mismas fórmulas.
13. **Rollback**: la migración es aditiva, así que se revierte borrando las tres tablas. Las órdenes, los ingresos y el estado mensual quedan como estaban — salvo `cogs_total` y `profit_gross` de los ingresos tocados por la recalculación, que habría que restaurar del respaldo si se quiere volver exactamente al estado previo.

## Open Questions

- **¿Traer `InventoryItem.unitCost` desde la GraphQL Admin API?** Poblaría `ProductCost` automáticamente con `source: SHOPIFY_INVENTORY`, con la advertencia de que Shopify sólo expone el costo *actual*: habría que darle `effective_from` de la fecha de importación, no retroactiva. Fuera de alcance aquí.
- **¿Colecciones vienen en el payload de la sincronización actual?** Si no, el eslabón `COLLECTION` de la cadena de categoría queda inactivo hasta que se amplíe la consulta a Shopify — cae solo a `TAG` o `UNKNOWN` sin romper nada.
- **¿Repartir comisiones y envío por línea?** Daría utilidad neta por producto en vez de sólo bruta. Requiere una regla de reparto (por valor, por peso, por unidades) que es una decisión de negocio sin tomar.
- **¿Debe `pending_cost_updates` disparar la recalculación automáticamente?** Hoy sólo avisa. Convertirlo en acción automática choca con el cierre mensual de MVP 3; conviene decidirlo junto con esa capacidad.
