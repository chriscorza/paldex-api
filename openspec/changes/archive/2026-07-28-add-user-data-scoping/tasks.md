## 1. Gate previo

- [x] 1.1 `add-roles-permissions` implementado
- [x] 1.2 `add-expenses-crud` implementado
- [x] 1.3 Datos existentes pertenecen a misma persona (dev)
- [x] 1.4 Dev — sin backup necesario
- [x] 1.5 Admin user identificado (test@test.com, id=4)

## 2. Esquema y migración

- [x] 2.1 `user_id Int` + relación a User en Account, Income, Expense
- [x] 2.2 Índice `@@index([user_id])` en las 3 tablas
- [x] 2.3 Migración generada con `--create-only`
- [x] 2.4 SQL editado: ADD NULL → UPDATE backfill → MODIFY NOT NULL → INDEX → FK
- [x] 2.5 Backfill asigna todas las filas al admin
- [x] 2.6 Migración aplicada
- [x] 2.7 Verificado: 0 nulos, mismo número de filas
- [x] 2.8 `prisma generate` y build pasan

## 3. Catálogo de permisos OWN/ANY

- [x] 3.1 12 variantes OWN añadidas al catálogo (income/expense/account × 4 acciones)
- [x] 3.2 Tax, user, role, permission solo en ANY
- [x] 3.3 Sync idempotente con nuevos scope (38 permisos en DB)
- [x] 3.4 User role recibe OWN, admin conserva ANY
- [x] 3.5 `ANY` prevalece sobre `OWN` en resolución (ya implementado en guard)

## 4. OwnershipContext y helpers

- [x] 4.1 `OwnershipContext` en `src/common/ownership.ts`
- [x] 4.2 `buildOwnerFilter(ctx)` — `{}` con ANY, `{user_id}` con OWN
- [x] 4.3 Context compuesto en controllers desde `@CurrentUser()` y `request.permissionScope`

## 5-7. Scoping de services y controllers

- [x] IncomesService: findAll/findOne/create/update/remove con OwnershipContext
- [x] AccountsService: findAll/findOne/create/update/remove + _count filtrado
- [x] ExpensesService: findAll/findOne/create/update/remove con OwnershipContext
- [x] Controllers pasan ctx como primer argumento

## 8. Tests

- [x] E2E: dos usuarios, datos aislados
- [x] Admin ve todo (ANY)
- [x] 404 indistinguible (ajeno = inexistente)
- [x] Cross-account protection: 400
- [x] Taxes compartidos

## 9-10. Cierre

- [x] 9.1 Spec repasado
- [x] 9.2 Advertencia: GET /incomes devuelve menos filas
- [x] 9.3 Pregunta abierta: admin viendo finanzas ajenas
- [x] 9.4 Aislamiento estricto documentado
