## Why

Hoy el negocio no puede saber cuánto vendió cada empleado: los reportes agregan todo el periodo en un solo total y `Income` no guarda quién atendió la venta. Como los turnos son fijos y no se solapan —Luis de lunes a viernes, Félix sábado y domingo—, el día de la venta ya identifica al empleado, así que se puede atribuir la venta sin capturar nada nuevo en cada ingreso.

## What Changes

- Nuevo campo `sales_days` en `Employee`: la lista de días de la semana (1 = lunes … 7 = domingo) cuyas ventas se le atribuyen. Vacío/nulo = no se le atribuye ninguna venta, que es el estado de todos los empleados actuales.
- El alta y la edición de empleados aceptan y validan `sales_days`: días dentro de 1–7, sin repetidos, y sin que dos empleados activos del mismo dueño reclamen el mismo día.
- Nuevo endpoint `GET /reports/sales-by-employee`: devuelve, por empleado, las ventas netas, las brutas y el número de ventas del periodo, más un renglón `unassigned` con las ventas de los días que ningún empleado tiene asignados.
- Sin parámetros responde el **mes en curso** en la zona del negocio; con `year` + `month` responde cualquier mes anterior, igual que el resto de `/reports`.
- El día de la venta se determina en la zona horaria del negocio (`REPORTS_TIMEZONE`), no en UTC: en CDMX una venta de las 19:00 del viernes es sábado en UTC y se le acreditaría a la persona equivocada.

No hay cambios que rompan clientes existentes: el campo nuevo es opcional y el endpoint es nuevo.

## Capabilities

### New Capabilities
- `sales-by-employee`: atribución de ventas a empleados por día de la semana — el campo `sales_days` y sus reglas de validación, y el reporte mensual de ventas por empleado con su rango de fechas por defecto.

### Modified Capabilities
<!-- Ninguna: no existe todavía un spec de employees-crud ni de reports en openspec/specs/, así que las reglas de `sales_days` viven en el spec nuevo. -->

## Impact

- **Schema/migración**: columna `sales_days` (JSON, nullable) en `employees`. Migración aditiva, sin backfill.
- **Código**: `src/employees/` (DTOs, servicio, validación), `src/reports/reports.controller.ts` + un servicio nuevo de agregación por empleado, `src/reports/dto/`.
- **Permisos**: reutiliza `report:read` (y su variante `OWN`); no hace falta una entrada nueva en `permission-catalog.ts`.
- **Datos**: alguien debe asignarle `sales_days` a Luis (`[1,2,3,4,5]`) y a Félix (`[6,7]`) por `PATCH /employees/:id`; hasta entonces el reporte devuelve todo bajo `unassigned`.
- **Frontend** (`paldex-app`): consume el endpoint nuevo vía el contrato de `/api-docs/json`.
