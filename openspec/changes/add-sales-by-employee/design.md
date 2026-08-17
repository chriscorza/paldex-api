## Context

`Income` no guarda quién hizo la venta y no hay intención de capturarlo venta por venta: los turnos del negocio son fijos y no se solapan, así que el día de la semana ya identifica al empleado (Luis lunes–viernes, Félix sábado–domingo). Lo que falta es (a) dónde vive esa asignación y (b) un agregado que la aplique.

Lo que ya existe y condiciona el diseño:

- `Employee` (`prisma/schema.prisma:458`) con su CRUD en `src/employees/`, ya con alcance de propiedad y validaciones de días de pago — hay un precedente directo de "campos de día validados en el servicio".
- `/reports` (`src/reports/reports.controller.ts`) resuelve rangos con `resolveDateRange()`, exige `report:read` a nivel de clase y siempre construye el rango en la zona del negocio vía `src/common/timezone.ts`.
- La regla de dinero del proyecto: sumar con `Prisma.Decimal`, nunca con `number`, y convertir a número sólo en la proyección de salida (`src/common/money.ts`).
- El reporte mensual toma las ventas netas de `Income.net_amount` y las brutas de `Income.gross_amount` (`reports-aggregation.service.ts:104`). El nuevo reporte debe usar exactamente esos campos o los totales no cuadrarán.

## Goals / Non-Goals

**Goals:**

- Atribuir las ventas de un periodo al empleado que tiene ese día de la semana asignado, calculando el día en la zona del negocio.
- Que la asignación sea un dato editable (no nombres en el código) y que Luis y Félix se configuren por API.
- Que el reporte cuadre exactamente con `net_sales` de `GET /reports/monthly` para el mismo periodo.
- Mes en curso por defecto, meses anteriores vía `year` + `month`.

**Non-Goals:**

- Turnos por hora, turnos partidos, o dos personas el mismo día. Un día pertenece a un empleado como mucho.
- Historial de turnos: si Luis y Félix intercambian días, los meses anteriores se recalculan con la asignación **actual**. Se asume explícitamente porque los turnos llevan fijos y el historial exige otro modelo (ver Riesgos).
- Atribución explícita por venta (un `employee_id` en `Income`), comisiones, metas, o utilidad bruta por empleado.
- Cambios en el frontend.

## Decisions

### 1. La asignación vive en `Employee.sales_days`, no en una tabla aparte

Columna `sales_days Json?` en `employees`, con un array de enteros `1..7` (ISO-8601: 1 = lunes, 7 = domingo).

- **Por qué**: es el dato más pequeño que resuelve el problema. Una tabla `employee_sales_shifts` daría unicidad por día a nivel de base de datos, pero mete un modelo, un módulo y endpoints nuevos para guardar como mucho siete filas.
- **Alternativas descartadas**: (a) tabla puente con `@@unique([user_id, day_of_week])` — más correcta pero desproporcionada hoy, y es a donde se migra si aparecen turnos por fecha; (b) mapeo en variable de entorno — no se liga a `Employee`, no sobrevive a un cambio de nombre y exige redesplegar para mover un turno.
- **Por qué `Json` y no siete booleanos ni una cadena `"1,2,3"`**: MySQL 8.4 valida el JSON, el schema ya usa `Json` (`ShopifyOrder.line_items`), y leerlo como `number[]` en TypeScript no necesita parseo a mano.

**Consecuencia asumida**: MySQL no puede imponer "un día, un empleado" sobre una columna JSON. Esa unicidad se aplica en el servicio (decisión 2).

### 2. La exclusividad del día se valida en `EmployeesService`, en la misma transacción que la escritura

Antes de crear o actualizar, se leen los demás empleados **activos** del mismo dueño con `sales_days` no vacío y se cruza contra los días entrantes; si hay intersección → `409 Conflict` nombrando el día y al empleado que ya lo tiene.

- La comprobación cubre tres caminos, no sólo el obvio: cambiar `sales_days`, y también **reactivar** un empleado (`active: false → true`) cuyos días ya estén tomados. Sin el tercero, un inactivo con `[6,7]` se reactiva y duplica silenciosamente las ventas del fin de semana en el reporte.
- Lectura y escritura van dentro de `this.prisma.$transaction` para que dos peticiones simultáneas no se cuelen entre la comprobación y el `update`. Es una carrera improbable con un puñado de empleados, pero la transacción cuesta una línea.
- El rango `1..7`, los enteros y los repetidos los rechaza `class-validator` en el DTO (`@IsArray`, `@IsInt({each:true})`, `@Min(1,{each:true})`, `@Max(7,{each:true})`, `@ArrayUnique()`) → `400`, coherente con el resto de la API. El solape es `409` porque el body es válido; el conflicto es con el estado.

### 3. El bucketing por día de la semana se hace en Node, no en SQL

El servicio trae los ingresos del periodo (`id`, `date`, `net_amount`, `gross_amount`), calcula el día de la semana de cada uno en la zona del negocio y acumula en `Decimal` por empleado.

- **Por qué no SQL**: agrupar por día de la semana en la zona correcta exige `CONVERT_TZ(date, '+00:00', 'America/Mexico_City')`, que en MySQL devuelve `NULL` si no están cargadas las tablas de zonas horarias (`mysql_tzinfo_to_sql`) — el contenedor `mysql:8.4` no las trae por defecto. Un reporte que devuelve ceros silenciosos según cómo se aprovisionó la base de datos no es aceptable. `Intl`, que ya usa `src/common/timezone.ts`, no depende de nada del servidor.
- **Volumen**: un mes de ingresos de un negocio de este tamaño son cientos, no millones de filas, y `incomes` ya tiene índice por `date` y por `user_id`. Se seleccionan sólo cuatro columnas.
- **Nueva utilidad**: `weekdayInZone(date, timeZone): 1..7` en `src/common/timezone.ts`, junto a las demás — con `Intl.DateTimeFormat({ weekday: 'short' })` y un mapa a ISO. No se usa `getDay()`, que lee la zona del servidor (UTC en el contenedor) y acreditaría el viernes por la noche de CDMX al turno del sábado.
- **Dinero**: los acumuladores son `Prisma.Decimal`; `toMoneyNumber()` sólo al proyectar la respuesta, según la regla del proyecto.

### 4. Un servicio propio, `SalesByEmployeeService`, dentro de `ReportsModule`

`reports-aggregation.service.ts` ya lleva 583 líneas y ninguna de sus funciones sirve aquí (todas devuelven un agregado plano del periodo, no un desglose por fila). Servicio nuevo en `src/reports/sales-by-employee.service.ts`, registrado en `ReportsModule`, y un handler en `ReportsController`, que ya aplica `report:read` a nivel de clase — **no** hace falta ninguna entrada nueva en `permission-catalog.ts`.

### 5. El rango por defecto es el mes en curso; `year` + `month` son opcionales pero van juntos

DTO propio `SalesByEmployeeQueryDto` con `year?` y `month?` (sin `start_date`/`end_date`: el requisito habla de meses, y admitir rangos sueltos obligaría a explicar qué significa "el mes" en la respuesta).

- Sin parámetros → `currentMonthInZone()`, que ya existe y evita que el día 1 antes de las 06:00 UTC el reporte salte al mes equivocado.
- Con ambos → `monthRangeInZone(year, month)`.
- Uno solo de los dos → `400`. Es un error de quien llama, y adivinar el que falta esconde el error.
- La respuesta devuelve `period: { year, month, start_date, end_date }` para que el cliente pinte el encabezado sin recalcular la zona.

### 6. `unassigned` siempre presente

Los ingresos cuyo día no tiene dueño —y los de días de empleados inactivos— caen en un renglón `unassigned` que aparece aunque valga cero. Es lo que hace verificable el reporte: la suma de los renglones tiene que dar el `net_sales` del reporte mensual, y sin ese renglón un día sin asignar haría desaparecer dinero sin dejar rastro.

Forma de la respuesta:

```json
{
  "period": { "year": 2026, "month": 8, "start_date": "...", "end_date": "..." },
  "rows": [
    { "employee_id": 3, "employee_name": "Luis", "sales_days": [1,2,3,4,5],
      "net_sales": 128450.00, "gross_sales": 141200.00, "sales_count": 212 },
    { "employee_id": 5, "employee_name": "Félix", "sales_days": [6,7],
      "net_sales": 64100.00, "gross_sales": 70300.00, "sales_count": 98 },
    { "employee_id": null, "employee_name": "unassigned", "sales_days": [],
      "net_sales": 0, "gross_sales": 0, "sales_count": 0 }
  ],
  "totals": { "net_sales": 192550.00, "gross_sales": 211500.00, "sales_count": 310 }
}
```

`totals` se incluye para que el cliente —y las pruebas— puedan comprobar el cuadre contra `/reports/monthly` sin sumar a mano.

## Risks / Trade-offs

- **El reporte de un mes pasado se recalcula con la asignación de hoy** → Es el precio de no guardar historial de turnos. Se documenta en el `@ApiOperation` del endpoint para que nadie lo interprete como un dato inmutable. Si algún día importa, la salida es una tabla `employee_sales_shifts` con vigencia (`effective_from` / `effective_to`); la forma de la respuesta no cambiaría.
- **Un día sin dueño esconde ventas** → Mitigado por el renglón `unassigned`, que siempre aparece y hace visible el hueco en vez de repartirlo.
- **La unicidad del día no la garantiza la base de datos** → Validación en servicio dentro de transacción, cubriendo también la reactivación. Una escritura directa a la base de datos sí puede romperla; en ese caso el reporte contaría la venta dos veces. Se acota con una prueba que verifica el cuadre de totales.
- **Ingresos con `net_amount` nulo** → `net_amount` y `gross_amount` son nullables en el schema; los ingresos manuales antiguos pueden no tenerlos. Se suman como cero, exactamente como hace `getMonthlyAggregates` con `?? new Decimal(0)`, para no divergir del reporte mensual. `sales_count` sí los cuenta.
- **Traer los ingresos a memoria** → Aceptable al volumen actual y con sólo cuatro columnas seleccionadas. Si un dueño llegara a decenas de miles de ventas al mes, la salida es un `$queryRaw` con el desplazamiento de zona ya calculado en Node e inyectado como parámetro, sin depender de las tablas de zonas de MySQL.

## Migration Plan

1. Añadir `sales_days Json?` a `Employee` y generar la migración: `docker exec paldex-api-1 npx prisma migrate dev --create-only`. Es aditiva y nullable — no hay backfill ni bloqueo de tabla relevante.
2. Desplegar. Con `sales_days` nulo en todas partes, el endpoint responde con `unassigned` llevándose el total: correcto, no roto.
3. Configurar los turnos por API: `PATCH /employees/:id` con `[1,2,3,4,5]` para Luis y `[6,7]` para Félix.
4. Verificar el cuadre: `GET /reports/sales-by-employee?year=…&month=…` contra `GET /reports/monthly` del mismo mes.

**Rollback**: el endpoint es nuevo y el campo es opcional; basta con revertir el despliegue. La columna puede quedarse sin efecto alguno sobre el código anterior.

## Open Questions

- ¿Debe el reporte incluir los ingresos que no son ventas (`income_type != SALE`)? Se implementa **sin filtrar por `income_type`**, igual que `getMonthlyAggregates`, para que el cuadre con `/reports/monthly` sea exacto. Si se quisiera sólo venta de mostrador, habría que filtrar en los dos sitios a la vez.
- ¿Hace falta `sales_days` en el listado `GET /employees` además de en el detalle? Se añade a `EMPLOYEE_PUBLIC_SELECT`, así que sale en ambos; si eso ensucia el listado del frontend, se recorta después.
