## 1. Esquema y migración

- [x] 1.1 Añadir `sales_days Json?` al modelo `Employee` en `prisma/schema.prisma`
- [x] 1.2 Generar la migración con `docker exec paldex-api-1 npx prisma migrate dev --create-only` y revisar que el SQL sea sólo un `ALTER TABLE employees ADD COLUMN sales_days JSON NULL`
- [x] 1.3 Aplicar la migración y regenerar el cliente Prisma

## 2. Día de la semana en la zona del negocio

- [x] 2.1 Añadir `weekdayInZone(date: Date, timeZone?: string): number` a `src/common/timezone.ts`, devolviendo 1 = lunes … 7 = domingo vía `Intl.DateTimeFormat({ weekday: 'short' })`, con el comentario de por qué no se usa `getDay()`
- [x] 2.2 Escribir pruebas de `weekdayInZone` en `src/common/timezone.spec.ts` (créalo si no existe): viernes 19:00 CDMX → 5 aunque en UTC sea sábado; domingo 23:30 CDMX → 7; un día dentro y otro fuera del horario de verano

## 3. `sales_days` en el CRUD de empleados

- [x] 3.1 Añadir `sales_days?: number[]` a `CreateEmployeeDto` y `UpdateEmployeeDto` (`src/employees/dto/create-employee.dto.ts`) con `@IsOptional`, `@IsArray`, `@IsInt({ each: true })`, `@Min(1, { each: true })`, `@Max(7, { each: true })`, `@ArrayUnique()` y `@ApiPropertyOptional`
- [x] 3.2 Añadir `sales_days: number[] | null` a `EmployeeEntity` y a `EMPLOYEE_PUBLIC_SELECT` (`src/employees/entities/employee.entity.ts`), normalizando el JSON a `number[]` (o `null`) en el constructor
- [x] 3.3 Persistir `sales_days` en `EmployeesService.create` y `EmployeesService.update`
- [x] 3.4 Implementar `validateSalesDaysExclusivity(ctx, days, { excludeEmployeeId })` en `EmployeesService`: consulta los demás empleados **activos** del mismo dueño con `sales_days` no vacío y lanza `ConflictException` nombrando el día y al empleado que ya lo tiene
- [x] 3.5 Invocar la validación en `create`, en `update` cuando llegue `sales_days`, **y en `update` cuando `active` pase de `false` a `true`** con días ya guardados
- [x] 3.6 Envolver lectura de solape + escritura en `this.prisma.$transaction` en `create` y `update`, para que dos peticiones simultáneas no se cuelen entre la comprobación y el guardado

## 4. Servicio de agregación

- [x] 4.1 Crear `src/reports/dto/sales-by-employee-query.dto.ts` con `year?` y `month?` (`@IsOptional`, `@IsInt`, `@Min(2000)` / `@Min(1)`+`@Max(12)`) y `@ApiPropertyOptional`
- [x] 4.2 Crear `src/reports/entities/sales-by-employee.entity.ts` con las clases de respuesta (`period`, `rows[]`, `totals`) para que `@nestjs/swagger` las documente — nada de tipos inline
- [x] 4.3 Crear `src/reports/sales-by-employee.service.ts` con `getSalesByEmployee(ctx, query)`: resuelve el rango (sin parámetros → `currentMonthInZone()`; con ambos → `monthRangeInZone()`; sólo uno → `BadRequestException`)
- [x] 4.4 En ese servicio, cargar los empleados **activos** del dueño con `sales_days` no vacío y construir el mapa día → empleado
- [x] 4.5 Cargar los ingresos del rango con `buildOwnerFilter(ctx)` seleccionando sólo `id`, `date`, `net_amount`, `gross_amount`, sin filtrar por `income_type` (para cuadrar con `/reports/monthly`)
- [x] 4.6 Acumular por empleado con `Prisma.Decimal`, tratando `net_amount`/`gross_amount` nulos como cero pero contándolos en `sales_count`; lo que caiga en un día sin dueño va a `unassigned`
- [x] 4.7 Proyectar la respuesta con `toMoneyNumber()`, incluyendo a los empleados sin ventas en cero, el renglón `unassigned` siempre, y `totals`
- [x] 4.8 Registrar `SalesByEmployeeService` en `providers` de `src/reports/reports.module.ts`

## 5. Endpoint

- [x] 5.1 Añadir `GET sales-by-employee` a `ReportsController` con `@ApiOperation` que explique que la atribución usa la asignación **actual** de días, también para meses pasados
- [x] 5.2 Confirmar que hereda `report:read` de la clase y que no hace falta ninguna entrada nueva en `src/permissions/permission-catalog.ts`
- [x] 5.3 Verificar que el endpoint aparece con su esquema de respuesta en `/api-docs`

## 6. Pruebas

- [x] 6.1 `src/employees/employees.service.spec.ts`: alta y edición con `sales_days`; `409` al solapar con un activo; sin `409` cuando el dueño del día está inactivo; `409` al reactivar a un inactivo con días solapados
- [x] 6.2 `src/reports/sales-by-employee.service.spec.ts`: mes con los dos turnos cubiertos, reparto correcto lunes–viernes / sábado–domingo
- [x] 6.3 Prueba de que un empleado sin ventas sale en ceros y de que `unassigned` aparece aunque valga cero
- [x] 6.4 Prueba del cuadre: la suma de `net_sales` de todos los renglones es igual al total de los ingresos del periodo
- [x] 6.5 Prueba de zona horaria: un ingreso del viernes 19:00 CDMX se acredita al turno del viernes, no al del sábado
- [x] 6.6 Pruebas del rango: sin parámetros → mes en curso en la zona del negocio; `year`+`month` → ese mes; `month: 13` → `400`; `year` sin `month` → `400`
- [x] 6.7 Prueba de alcance `OWN`: no se filtran empleados ni importes de otro dueño

## 7. Cierre

- [x] 7.1 Ejecutar `npm run lint` y `npm test` y dejarlos en verde
- [x] 7.2 Documentar `sales_days` y el endpoint en `paldex-api/CLAUDE.md` (una nota corta: la atribución es por día de la semana, en la zona del negocio, sin historial de turnos)
- [ ] 7.3 Asignar los turnos reales por `PATCH /employees/:id` (Luis `[1,2,3,4,5]`, Félix `[6,7]`) y comparar el resultado contra `GET /reports/monthly` del mes en curso
  - Bloqueada: la base de datos de desarrollo no tiene ningún empleado ni ingreso, así que Luis y Félix no existen aquí. El mecanismo sí quedó verificado de punta a punta contra MySQL con datos temporales (reparto correcto, ida y vuelta de la columna JSON, cuadre de totales); asignar los turnos reales es un paso de datos sobre el entorno donde vive esa información.
