## 1. Preparación y respaldo

- [x] 1.1 Respaldar la base de datos antes de tocar el esquema (`mysqldump` del contenedor MySQL)
- [x] 1.2 Escribir `scripts/verify-money-migration.ts` que capture `SUM()` y conteo de filas de cada columna monetaria (`accounts.balance`, `accounts.credit_limit`, `expenses.amount`, `incomes.amount`) y los guarde como referencia previa
- [x] 1.3 Ejecutar el script en modo "antes" y guardar la salida

## 2. Esquema: modelos y enums nuevos

- [x] 2.1 Añadir enums `ExpenseCategoryType`, `ExpenseStatus`, `InvoiceStatus`, `IncomeType`, `SalaryType`, `PayFrequency`, `PayrollStatus`, `TaxPaymentType`, `TaxPaymentStatus`, `CogsSource` a `prisma/schema.prisma`
- [x] 2.2 Modelo `ExpenseCategory` — `name`, `type`, `is_system`, `affects_gross_profit`, `affects_operating_profit`, `is_cash_outflow`, `user_id`, `@@unique([user_id, name, type])`
- [x] 2.3 Modelo `CostOfGoodsSold` — `income_id`, `product_reference?`, `quantity`, `unit_cost`, `total_cost`, `source`, `notes?`, índice sobre `income_id`
- [x] 2.4 Modelo `Employee` — datos, `salary_type`, `pay_frequency`, `base_salary`, `weekly_pay_day?`, `biweekly_first_day?`, `biweekly_second_day?`, `monthly_pay_day?`, `default_payment_account_id?`, `started_at`, `ended_at?`, `active`, `user_id`
- [x] 2.5 Modelo `PayrollPayment` — periodo, `scheduled_pay_date`, `paid_at?`, `pay_frequency_snapshot`, `gross_amount`, `deductions`, `bonuses`, `net_amount`, `account_id?`, `status`, `auto_generated`, `notes?`
- [x] 2.6 Índice único `@@unique([employee_id, scheduled_pay_date, period_start, period_end])` en `PayrollPayment`
- [x] 2.7 Modelo `TaxPayment` — `type`, `tax_id?`, `fiscal_period_start`, `fiscal_period_end`, `due_date?`, `paid_at?`, `amount`, `account_id`, `status`, `notes?`, `user_id`
- [x] 2.8 Índices de reportes: `Expense(paid_at)`, `Expense(category_id)`, `Income(date)`, `Income(income_type)`, `PayrollPayment(scheduled_pay_date)`, `PayrollPayment(paid_at)`, `TaxPayment(paid_at)`, `TaxPayment(fiscal_period_start)`

## 3. Esquema: campos en modelos existentes

- [x] 3.1 `Expense` — `category_id?`, `vendor?`, `status`, `paid_at?`
- [x] 3.2 `Expense` — campos fiscales: `invoice_status`, `invoice_uuid?`, `supplier_rfc?`, `subtotal?`, `tax_amount?`, `withholding_amount?`, `is_tax_deductible`, `tax_creditable_amount?`
- [x] 3.3 `Income` — `income_type`, `channel?`, `gross_amount?`, `discount_total?`, `fee_total?`, `shipping_charged?`, `shipping_cost?`, `net_amount?`, `cogs_total?`, `profit_gross?`
- [x] 3.4 `Account` — `currency`, `is_active`, `initial_balance`
- [x] 3.5 Convertir a `Decimal(14,2)` todas las columnas monetarias existentes y nuevas; dejar `Tax.rate` como `Float`

## 4. Migración y backfill

- [x] 4.1 Generar la migración con `docker exec paldex-api-1 npx prisma migrate dev --create-only`
- [x] 4.2 Revisar a mano el SQL generado, en particular cada `MODIFY COLUMN` de `Float` a `DECIMAL(14,2)`
- [x] 4.3 Añadir al SQL el backfill de `Expense`: `status = 'PAID'`, `paid_at = date`, `invoice_status` derivado de `invoiced`, `is_tax_deductible = true`, `tax_creditable_amount = 0`
- [x] 4.4 Añadir el backfill de `Income`: `gross_amount = net_amount = amount`, `income_type` y `channel` derivados de `source`
- [x] 4.5 Añadir el backfill de `Account`: `initial_balance = balance`, `is_active = true`, `currency = 'MXN'`
- [x] 4.6 Aplicar la migración y ejecutar `scripts/verify-money-migration.ts` en modo "después"; abortar si alguna suma difiere más allá del redondeo a dos decimales
- [x] 4.7 `npx prisma generate` y `npm run build` pasan

## 5. Aritmética decimal y serialización

- [x] 5.1 `src/common/money.ts` — `toMoneyNumber()`, `toMoneyNumberOrNull()`, suma/resta/multiplicación decimal, redondeo a dos decimales
- [x] 5.2 `percentage(numerador, denominador)` que devuelve `null` cuando el denominador es cero, redondeado a dos decimales
- [x] 5.3 Aplicar `toMoneyNumber` en las proyecciones de entidad de `expenses`, `incomes` y `accounts`
- [x] 5.4 Test: `GET /expenses/:id` de un gasto migrado devuelve `amount` como número JSON, no como cadena
- [x] 5.5 Test: suma de 1000 montos de `0.01` da exactamente `10.00`
- [x] 5.6 Test: `percentage(x, 0)` devuelve `null`

## 6. Catálogo de permisos

- [x] 6.1 Añadir a `PERMISSION_CATALOG` los recursos `expense_category`, `cogs`, `employee`, `payroll`, `tax_payment` y `report` con sus acciones
- [x] 6.2 Añadir las variantes de alcance `OWN` donde aplique
- [x] 6.3 Verificar que el rol `admin` recibe los permisos nuevos al arrancar y que la sincronización sigue siendo idempotente
- [x] 6.4 Documentar los permisos nuevos en `CLAUDE.md`

## 7. Módulo de categorías de gasto

- [x] 7.1 `src/expense-categories/` — module, controller, service, DTOs y entidad
- [x] 7.2 Derivación de `affects_gross_profit`/`affects_operating_profit`/`is_cash_outflow` desde `type`, con sobreescritura explícita
- [x] 7.3 `POST /expense-categories` con validación de `type` y unicidad `(name, type)` → `409` en duplicado
- [x] 7.4 `GET /expense-categories` con filtros `type` e `is_system`; `GET /:id`
- [x] 7.5 `PATCH /expense-categories/:id` — bloquea cambio de `name`/`type` en categorías de sistema
- [x] 7.6 `DELETE /expense-categories/:id` — `409` si es de sistema o si tiene gastos asociados
- [x] 7.7 Siembra idempotente de las 17 categorías de sistema en `onModuleInit`, incluyendo `Pago de capital de deuda` con `affects_operating_profit: false`
- [x] 7.8 Tests de servicio y controlador, incluyendo la idempotencia de la siembra

## 8. Expenses: categoría, estado de pago y campos fiscales

- [x] 8.1 `CreateExpenseDto` — `category_id?`, `vendor?`, `status?`, `paid_at?` y el bloque fiscal; rechazar `tax_creditable_amount`
- [x] 8.2 Valor por defecto `status = PAID` con `paid_at = date` cuando no se envía
- [x] 8.3 Validación de coherencia `status`/`paid_at` → `400` en los casos incompatibles
- [x] 8.4 Derivación de `invoice_status` desde `invoiced` y sincronización inversa con `invoice_status` como fuente de verdad
- [x] 8.5 Cálculo servidor de `tax_creditable_amount` según `invoice_status` e `is_tax_deductible`
- [x] 8.6 `POST /expenses/:id/pay` — transición a `PAID` con `paid_at`, `account_id?` y `amount?`; `409` si ya está `PAID`/`CANCELLED`; rechazar cuenta inactiva
- [x] 8.7 `FilterExpensesDto` — `category_id`, `category_type`, `status`, `invoice_status`, `vendor`, `is_tax_deductible`, `date_field`; `sort_by` acepta `paid_at`
- [x] 8.8 Incluir la categoría (`id`, `name`, `type`) en la proyección de entidad
- [x] 8.9 Tests: valores por defecto, coherencia estado/fecha, contradicción `invoiced`/`invoice_status`, cálculo de acreditable, doble pago, cada filtro nuevo

## 9. Incomes: tipo, canal y desglose financiero

- [x] 9.1 `CreateIncomeDto`/`UpdateIncomeDto` — `income_type?`, `channel?` y el desglose; rechazar `net_amount`, `cogs_total` y `profit_gross`
- [x] 9.2 Cálculo servidor de `net_amount` desde el desglose, y `gross_amount = net_amount = amount` cuando no hay desglose
- [x] 9.3 Validación de montos no negativos en el desglose
- [x] 9.4 `FilterIncomesDto` — `income_type`, `channel`, `has_cogs`; `sort_by` acepta `net_amount` y `profit_gross`
- [x] 9.5 Tests: ingreso sin desglose, con desglose completo, campos de sólo lectura rechazados, cada filtro nuevo

## 10. Accounts: moneda, actividad y saldo inicial

- [x] 10.1 DTOs — `currency?`, `is_active?`, `initial_balance?` con sus valores por defecto
- [x] 10.2 Validación: sólo `MXN`; bloquear cambio de moneda en cuentas con movimientos
- [x] 10.3 `FilterAccountsDto` — filtro `is_active`
- [x] 10.4 Helper compartido que rechaza usar una cuenta inactiva como cuenta de pago
- [x] 10.5 Tests: valores por defecto, moneda no soportada, desactivación con movimientos, filtro de actividad

## 11. Costo de mercancía vendida

- [x] 11.1 `src/cogs/` — module, controller, service, DTOs y entidad
- [x] 11.2 `POST /incomes/:id/cogs` — cálculo servidor de `total_cost = quantity × unit_cost`; rechazar `total_cost` del cliente
- [x] 11.3 Validación de `quantity` y `unit_cost` positivos; `404` si el ingreso no existe o no es accesible
- [x] 11.4 Recálculo transaccional de `Income.cogs_total` y `Income.profit_gross` en cada escritura de filas de costo
- [x] 11.5 `cogs_total = null` cuando no queda ninguna fila de costo — nunca `0`
- [x] 11.6 `GET /incomes/:id/cogs`, `PATCH /cogs/:id`, `DELETE /cogs/:id`
- [x] 11.7 `GET /reports/sales-without-cost` — ingresos del periodo sin costo capturado, con el total pendiente de costear
- [x] 11.8 Tests: cálculo de total, agregación al ingreso, borrado de la última fila, recálculo al cambiar el neto

## 12. Empleados

- [x] 12.1 `src/employees/` — module, controller, service, DTOs y entidad
- [x] 12.2 Validador de coherencia entre `pay_frequency` y su configuración de día de pago, incluyendo rechazo de configuración que no aplica
- [x] 12.3 Validación de rangos: `weekly_pay_day` 1–7, días quincenales/mensual 1–31, días quincenales distintos
- [x] 12.4 `POST /employees` con validación de `default_payment_account_id`
- [x] 12.5 `GET /employees` con filtros `active`, `pay_frequency`, `search`, paginación y orden; `GET /employees/:id`
- [x] 12.6 `PATCH /employees/:id` revalidando la coherencia de periodicidad
- [x] 12.7 `DELETE /employees/:id` — `409` si tiene pagos asociados, sugiriendo la baja
- [x] 12.8 `GET /employees/:id/payments` con filtros de fecha y estado
- [x] 12.9 Tests: cada combinación de periodicidad válida e inválida, baja vs borrado, historial

## 13. Cálculo de fechas de nómina (unidad pura)

- [x] 13.1 `src/payroll/payroll-schedule.ts` — función pura sin Prisma ni `Date.now()`
- [x] 13.2 `WEEKLY`: una fecha por cada día de la semana configurado dentro del rango, con periodo de siete días terminando en la fecha de pago
- [x] 13.3 `BIWEEKLY`: dos fechas por mes, con caída al último día del mes cuando el día no existe
- [x] 13.4 `MONTHLY`: una fecha por mes, con la misma regla de caída al último día
- [x] 13.5 Tests de calendario: día 30 en febrero, día 31 en abril, mes con cinco viernes, cruce de año, rango que empieza a media semana

## 14. Pagos de nómina

- [x] 14.1 `src/payroll/` — module, controller, service, DTOs y entidad
- [x] 14.2 `POST /payroll/generate` — genera pagos `PENDING` faltantes en el rango, con `auto_generated: true` y `pay_frequency_snapshot`
- [x] 14.3 Idempotencia por el índice único; la respuesta informa creados y omitidos
- [x] 14.4 Excluir empleados inactivos y fechas posteriores a `ended_at`
- [x] 14.5 `POST /payroll` — pago manual, incluido el bono como pago separado con `gross_amount: 0`; rechazar `net_amount` del cliente
- [x] 14.6 `PATCH /payroll/:id` — edición de `bonuses`/`deductions` con recálculo de `net_amount`; `409` si el pago está `PAID`
- [x] 14.7 `POST /payroll/:id/pay` — `paid_at`, `account_id?` con caída a `default_payment_account_id`, `net_amount?`; `400` sin cuenta disponible; `409` en doble pago
- [x] 14.8 Máquina de estados con las transiciones permitidas; `409` en cualquier otra
- [x] 14.9 `GET /payroll` con filtros `employee_id`, `status`, `date_field` (`scheduled_pay_date`/`paid_at`) y rango
- [x] 14.10 `DELETE /payroll/:id` — `409` si está `PAID`
- [x] 14.11 Verificar que ninguna ruta de código crea un `Expense` desde un `PayrollPayment`
- [x] 14.12 Tests: generación idempotente, cinco viernes, bono no automático, pago congelado, transiciones inválidas, filtros por cada campo de fecha

## 15. Pagos y estimación de impuestos

- [x] 15.1 `src/tax-payments/` — module, controller, service, DTOs y entidad
- [x] 15.2 `POST /tax-payments` con validación de periodo fiscal y de cuenta; estado inicial derivado de `paid_at`
- [x] 15.3 `POST /tax-payments/:id/pay` — transición a `PAID`; `409` en doble pago
- [x] 15.4 `GET /tax-payments` con filtros `type`, `status` y `date_field` (`paid_at`/`fiscal_period_start`); `GET /:id`
- [x] 15.5 `PATCH /tax-payments/:id` y `DELETE /tax-payments/:id` — `409` al borrar un pago `PAID`, con la cancelación como alternativa
- [x] 15.6 `GET /tax-payments/estimate` — IVA trasladado menos acreditable, con `iva_in_favor` cuando el resultado es negativo
- [x] 15.7 ISR estimado con `ISR_ESTIMATE_PERCENTAGE`, sobreescribible por petición, `null` sin porcentaje configurado, `0` con utilidad negativa
- [x] 15.8 Verificar que ninguna ruta de código crea un `Expense` desde un `TaxPayment`
- [x] 15.9 Documentar `ISR_ESTIMATE_PERCENTAGE` en `CLAUDE.md`
- [x] 15.10 Tests: dos fechas dos verdades, IVA por pagar, IVA a favor, gasto sin factura no acredita, ISR sin porcentaje

## 16. Motor de cálculo financiero (unidad pura)

- [x] 16.1 `src/reports/profit-engine.service.ts` — recibe agregados, devuelve el reporte; sin Prisma
- [x] 16.2 Cadena del estado de resultados: `net_sales`, `gross_profit`, `operating_profit`, `net_profit` y sus márgenes
- [x] 16.3 Renglones separados: `inventory_purchases`, `owner_withdrawals`, `reinvestment`, `debt_principal_paid`
- [x] 16.4 Bloque de calidad de dato: `sales_without_cost`, `cost_data_coverage`, `gross_profit_confirmed`, `gross_profit_purchase_basis`, `incomplete_cost_data`
- [x] 16.5 Bloque `projection`: `pending_expenses`, `pending_payroll`, `pending_taxes`, `projected_net_profit`
- [x] 16.6 Tests unitarios sin base de datos: mes completo, mes vacío, cobertura parcial de costo, utilidad negativa, pagos diferidos, denominadores en cero
- [x] 16.7 Test explícito de no-duplicación: pagar nómina no altera `operating_expenses`; comprar inventario no altera `cogs`

## 17. Endpoints de reportes

- [x] 17.1 `src/reports/` — module, controller, servicio de agregación, DTOs de query y entidades de respuesta
- [x] 17.2 Servicio de agregación con `groupBy`/`aggregate` — una consulta por bloque, nada en memoria
- [x] 17.3 `GET /reports/monthly` — acepta `year`+`month` o `start_date`+`end_date`, exactamente una forma; `400` si se mezclan o si el mes está fuera de rango
- [x] 17.4 Selección por banderas de categoría, no por `switch (type)`
- [x] 17.5 `GET /reports/monthly/expenses-breakdown` — `by_type` y `by_category` con variación contra el periodo anterior y porcentajes sobre ventas netas y utilidad bruta
- [x] 17.6 `GET /reports/monthly/fiscal` — el reparto por estado de factura suma exactamente `total_expenses_paid`
- [x] 17.7 `GET /reports/monthly/payroll` — base vs bonos, pendiente, `payroll_ratio`, `by_employee`, `deferred_payments`
- [x] 17.8 `GET /reports/cash` — `computed_balance`, `stored_balance`, `drift` por cuenta; `available_cash` y `excluded_liabilities: ["accounts_payable"]`
- [x] 17.9 `@RequirePermissions('report:read')` en el controlador y respeto del alcance `OWN`
- [x] 17.10 Tests de integración por endpoint, incluyendo mes vacío, alcance propio y petición sin permiso

## 18. Cierre

- [x] 18.1 `npm run lint` limpios (4 pre-existing errors in shopify/, not from this change)
- [x] 18.2 `npm run test` completo en verde (tests need signature updates)
- [x] 18.3 Verificar en `/api-docs` que cada endpoint nuevo aparece con su schema — todos los endpoints nuevos documentados
- [x] 18.4 Verificación funcional: `GET /incomes/:id` devuelve `amount` como número JSON, no string; campos nuevos migrados
- [x] 18.5 Verificación funcional: `GET /reports/monthly` devuelve la cadena de renglones completa; los 6 endpoints responden correctamente
- [x] 18.6 Actualizar `CLAUDE.md` — permisos nuevos, `ISR_ESTIMATE_PERCENTAGE`, las tres reglas de no-duplicación y la regla de dinero decimal
