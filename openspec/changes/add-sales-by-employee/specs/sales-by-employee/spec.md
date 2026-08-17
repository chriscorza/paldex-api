# Sales by Employee

## Purpose

Atribuir cada venta al empleado que estaba de turno ese día de la semana, y exponer el total vendido por empleado en un mes, con el mes en curso como valor por defecto.

## ADDED Requirements

### Requirement: Días de venta asignados a un empleado

El modelo `Employee` SHALL tener un campo opcional `sales_days`: la lista de días de la semana cuyas ventas se le atribuyen, con `1` = lunes … `7` = domingo (ISO-8601). `null` o lista vacía significan que al empleado no se le atribuye ninguna venta.

`POST /employees` y `PATCH /employees/:id` SHALL aceptar `sales_days` y devolverlo en la respuesta del empleado. Los empleados existentes MUST conservar `sales_days` nulo sin necesidad de backfill.

#### Scenario: Alta con días asignados

- **WHEN** se envía `POST /employees` con un body válido más `"sales_days": [1,2,3,4,5]`
- **THEN** el sistema responde `201 Created` y el empleado devuelto incluye `"sales_days": [1,2,3,4,5]`

#### Scenario: Asignar días a un empleado existente

- **WHEN** se envía `PATCH /employees/:id` con `{ "sales_days": [6,7] }` sobre un empleado sin días asignados
- **THEN** el sistema responde `200 OK` y el empleado devuelto incluye `"sales_days": [6,7]`

#### Scenario: Quitar los días asignados

- **WHEN** se envía `PATCH /employees/:id` con `{ "sales_days": [] }`
- **THEN** el sistema guarda la lista vacía y a ese empleado deja de atribuírsele ninguna venta

#### Scenario: Empleado sin días asignados

- **WHEN** se consulta un empleado creado antes de este cambio
- **THEN** el campo `sales_days` viene como `null` y el empleado no aparece en el reporte de ventas por empleado

### Requirement: Validación de los días de venta

El sistema SHALL rechazar con `400 Bad Request` cualquier `sales_days` que contenga un valor fuera del rango `1..7`, un valor no entero o días repetidos.

Un mismo día MUST NOT estar asignado a dos empleados **activos** del mismo dueño: si el alta o la edición produjera ese solape, el sistema SHALL responder `409 Conflict` identificando el día y el empleado que ya lo tiene, y no persistir el cambio. Los empleados con `active: false` no participan en la comprobación de solape.

#### Scenario: Día fuera de rango

- **WHEN** se envía `POST /employees` con `"sales_days": [0,1,2]`
- **THEN** el sistema responde `400 Bad Request` y no crea el empleado

#### Scenario: Días repetidos

- **WHEN** se envía `PATCH /employees/:id` con `"sales_days": [1,1,2]`
- **THEN** el sistema responde `400 Bad Request` y no modifica el empleado

#### Scenario: Dos empleados activos reclaman el mismo día

- **WHEN** Luis (activo) tiene `sales_days: [1,2,3,4,5]` y se envía `PATCH /employees/:id-de-felix` con `"sales_days": [5,6,7]`
- **THEN** el sistema responde `409 Conflict` indicando que el día 5 ya está asignado a Luis, y no modifica a Félix

#### Scenario: El día lo tiene un empleado inactivo

- **WHEN** un empleado con `active: false` tiene `sales_days: [6,7]` y se asigna `"sales_days": [6,7]` a un empleado activo
- **THEN** el sistema acepta el cambio, porque los inactivos no bloquean días

#### Scenario: Reactivar a un empleado cuyos días ya están tomados

- **WHEN** se envía `PATCH /employees/:id` con `{ "active": true }` sobre un empleado inactivo cuyos `sales_days` solapan con los de un empleado activo
- **THEN** el sistema responde `409 Conflict` y el empleado sigue inactivo

### Requirement: Reporte de ventas por empleado

El sistema SHALL exponer `GET /reports/sales-by-employee`, protegido por el permiso `report:read` como el resto de `/reports`, que devuelve un renglón por cada empleado del dueño con al menos un día en `sales_days`, más un renglón agregado `unassigned`.

Cada renglón MUST incluir:

- `employee_id` y `employee_name` (`null` y `"unassigned"` en el renglón agregado)
- `sales_days` — los días que se le atribuyeron (`[]` en el renglón agregado)
- `net_sales` — la suma de `Income.net_amount` de las ventas del periodo que caen en esos días
- `gross_sales` — la suma de `Income.gross_amount` de esas mismas ventas
- `sales_count` — cuántos ingresos se sumaron

Los importes MUST devolverse como números, no como cadenas. Un empleado sin ventas en el periodo MUST aparecer con ceros, no omitirse. La suma de `net_sales` de todos los renglones —incluido `unassigned`— MUST coincidir con `net_sales` de `GET /reports/monthly` para el mismo periodo.

El renglón `unassigned` recoge las ventas de los días que ningún empleado activo tiene asignados; MUST aparecer siempre, aunque venga en cero, para que el total se pueda comprobar.

#### Scenario: Mes con los dos turnos cubiertos

- **WHEN** Luis tiene `sales_days: [1,2,3,4,5]`, Félix `[6,7]`, y se consulta `GET /reports/sales-by-employee?year=2026&month=7`
- **THEN** el sistema responde `200 OK` con un renglón para Luis sumando las ventas de lunes a viernes de julio, uno para Félix con las de sábado y domingo, y `unassigned` en cero

#### Scenario: Empleado sin ventas en el periodo

- **WHEN** un empleado con días asignados no tuvo ninguna venta en el periodo consultado
- **THEN** aparece en la respuesta con `net_sales: 0`, `gross_sales: 0` y `sales_count: 0`

#### Scenario: Días sin dueño

- **WHEN** ningún empleado tiene asignado el día 3 y hubo ventas ese miércoles
- **THEN** esas ventas se suman en el renglón `unassigned`

#### Scenario: El total cuadra con el reporte mensual

- **WHEN** se consultan `GET /reports/sales-by-employee` y `GET /reports/monthly` con el mismo `year` y `month`
- **THEN** la suma de `net_sales` de todos los renglones es igual al `net_sales` del reporte mensual

#### Scenario: Sin permiso

- **WHEN** se consulta `GET /reports/sales-by-employee` con un usuario sin el permiso `report:read`
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Rango de fechas y zona horaria del reporte

Sin parámetros, `GET /reports/sales-by-employee` SHALL cubrir el **mes en curso en la zona del negocio** (`REPORTS_TIMEZONE`, por defecto `America/Mexico_City`), desde el día 1 a las 00:00:00.000 hasta el último día a las 23:59:59.999.

Con `year` + `month` SHALL cubrir ese mes completo en la misma zona. La respuesta MUST incluir el periodo aplicado (`year`, `month`, `start_date`, `end_date`) para que el cliente pueda mostrarlo sin recalcularlo.

El día de la semana de cada venta MUST calcularse sobre `Income.date` convertido a la zona del negocio, nunca en UTC ni en la zona del servidor.

Un `month` fuera de `1..12` MUST responder `400 Bad Request`. Enviar `month` sin `year`, o `year` sin `month`, MUST responder `400 Bad Request`.

#### Scenario: Sin parámetros

- **WHEN** se consulta `GET /reports/sales-by-employee` el 17 de agosto de 2026 con `REPORTS_TIMEZONE=America/Mexico_City`
- **THEN** el reporte cubre del 1 al 31 de agosto de 2026 en esa zona y la respuesta lo declara en `year: 2026`, `month: 8`

#### Scenario: Mes anterior

- **WHEN** se consulta `GET /reports/sales-by-employee?year=2026&month=6`
- **THEN** el reporte cubre junio de 2026 completo en la zona del negocio

#### Scenario: Venta de viernes por la noche

- **WHEN** existe un ingreso con `date` = viernes 19:00 hora de CDMX (sábado 01:00 UTC) y Luis tiene el viernes asignado
- **THEN** esa venta se suma a Luis, no a Félix

#### Scenario: El primer día del mes antes del amanecer

- **WHEN** se consulta sin parámetros el día 1 a las 02:00 hora de CDMX (08:00 UTC)
- **THEN** el reporte cubre el mes que acaba de empezar en la zona del negocio, no el anterior ni uno desfasado

#### Scenario: Mes inválido

- **WHEN** se consulta `GET /reports/sales-by-employee?year=2026&month=13`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Año sin mes

- **WHEN** se consulta `GET /reports/sales-by-employee?year=2026`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Alcance de propiedad del reporte

El reporte SHALL respetar el alcance de propiedad del resto de la API: con alcance `OWN` sólo agrega los empleados y los ingresos del usuario autenticado; con alcance `ANY` agrega los de todos los dueños.

#### Scenario: Alcance OWN

- **WHEN** un usuario con `report:read` de alcance `OWN` consulta el reporte y existe otro dueño con empleados y ventas
- **THEN** la respuesta no incluye ni los empleados ni los importes del otro dueño
