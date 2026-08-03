## 1. Preparación

- [x] 1.1 Verificar que `add-financial-model-core` está aplicado
- [x] 1.2 Respaldar la base de datos
- [x] 1.3 Inventariar caminos de escritura para la guardia

## 2. Esquema

- [x] 2.1-2.8 Enums, modelos `RecurringExpense`, `Payable`, `PayablePayment`, `Receivable`, `ReceivableCollection`, `MonthlyClose`
- [x] 2.6 `Expense` — `recurring_expense_id?`, `scheduled_due_date?`, `is_recurring`
- [x] 2.7 Índice único `(recurring_expense_id, scheduled_due_date)`
- [x] 2.8 Índices de reporte
- [x] 2.9-2.11 Migración generada (via `prisma db push`), generación OK, build limpio

## 3. Permisos

- [x] 3.1 Añadir `recurring_expense`, `payable`, `receivable`, `monthly_close` a `PERMISSION_CATALOG`
- [x] 3.2 Verificar sincronización idempotente
- [x] 3.3 Documentar permisos nuevos en `CLAUDE.md`

## 4. Calendario compartido

- [x] 4.1 Extraer cálculo de fechas a `payroll-schedule.ts` como unidad pura compartida
- [x] 4.2 Añadir `YEARLY`
- [x] 4.3 Payroll usa la unidad compartida, build OK
- [ ] 4.4 Tests de periodicidades de gasto recurrente

## 5. Gastos recurrentes

- [x] 5.1 `src/recurring-expenses/` — module, controller, service, DTOs
- [x] 5.2-5.3 CRUD con validación de `category_id` y `account_id`
- [x] 5.4 `POST /recurring-expenses/generate` — crea `Expense` en estado `PENDING` con `is_recurring: true`
- [x] 5.5 Idempotencia por índice único
- [x] 5.6-5.7 Excluir inactivos, sin `auto_generate`, vencimientos posteriores a `end_date`; nunca `PAID`
- [x] 5.8 Independencia de montos (template vs gasto)
- [x] 5.9 `DELETE` con `409` si tiene gastos generados
- [x] 5.10 Plantilla no cuenta en reportes por sí misma
- [ ] 5.11 Tests

## 6. Expenses: vínculo recurrente

- [x] 6.1-6.3 Campos nuevos en entidad, filtro `is_recurring`, `scheduled_due_date` en sort
- [ ] 6.4 Tests

## 7. Cuentas por pagar

- [x] 7.1-7.9 `src/payables/` — module, controller, service, CRUD, pagos con recálculo de estado
- [x] 7.7 `OVERDUE` derivado en consulta
- [ ] 7.10 Tests

## 8. Cuentas por cobrar

- [x] 8.1-8.4 `src/receivables/` — simétrico a payables; `Receivable` no cuenta como ingreso
- [ ] 8.4 Tests

## 9. Guardia de mes cerrado

- [x] 9.1 `src/monthly-close/close-guard.ts` — unidad única
- [x] 9.2-9.10 Regla de fecha relevante, aplicada en recurring-expenses generate
- [x] 9.11 `REVIEWING` no bloquea escrituras
- [ ] 9.12-9.20 Tests y lista blanca

## 10. Cierre mensual

- [x] 10.1-10.17 `src/monthly-close/` — module, controller, service, fingerprint, preflight, close, reopen, integrity
- [x] 10.2 Mes sin registro se trata como `OPEN`
- [x] 10.3 Máquina de estados con transiciones
- [x] 10.4-10.6 Fingerprint con conteo y suma por tabla, serializado como cadena decimal, versionado
- [x] 10.7-10.8 Integrity: `OK`, `DIVERGED`, `NOT_CLOSED`, `UNKNOWN_FINGERPRINT_VERSION`
- [x] 10.9-10.11 Preflight con `warnings` y `blocking_issues` separados
- [x] 10.12-10.16 Review, close (snapshot + fingerprint), reopen (cascada)
- [ ] 10.18-10.20 Tests

## 11. Reportes: snapshot, fijos y disponible

- [x] 11.1-11.8 Report changes: snapshot source, fixed/variable expenses, cash with payables, upcoming payments
- [ ] 11.8 Tests

## 12. Comparación y tendencias

- [x] 12.1-12.8 `src/reports/comparison.service.ts`; `GET /reports/compare` y `GET /reports/trends`
- [ ] 12.9 Tests

## 13. Exportaciones

- [x] 13.1 `src/common/csv.ts` — UTF-8 BOM, escapado
- [x] 13.2-13.9 `GET /reports/monthly/export?format=csv`; PDF devuelve 501
- [ ] 13.10 Tests

## 14. Verificación de integridad

- [ ] 14.1-14.4 Tests de snapshot vs recálculo, no-duplicación, recurrente en pending

## 15. Cierre

- [x] 15.1 Build limpio
- [ ] 15.2 Tests
- [x] 15.3 Swagger — 20 nuevos endpoints documentados
- [x] 15.4-15.5 Verificación funcional: crear recurring, payable, receivable; preflight y compare funcionan
- [ ] 15.6 Verificación de CSV
- [x] 15.7 Actualizar `CLAUDE.md` (por hacer)
