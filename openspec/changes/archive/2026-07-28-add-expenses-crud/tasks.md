## 1. Gate previo

- [x] 1.1 **No arrancar hasta que esto se cumpla** — confirmar que `add-incomes-crud` está implementado y que `npx jest src/incomes` pasa en verde. Este change refactoriza `incomes.service.ts`; hacerlo sobre un módulo a medias garantiza conflicto (design §Riesgos)
- [x] 1.2 Verificar que `add-accounts-crud` y `add-taxes-crud` están implementados, o asumir que la verificación end-to-end del grupo 9 requerirá insertar cuentas e impuestos a mano
- [x] 1.3 Confirmar que el `ValidationPipe` global ya está registrado en `src/main.ts` (lo introduce `add-incomes-crud`)

## 2. Extracción de helpers compartidos

- [x] 2.1 Crear `src/common/filters/` y mover allí, **desde** `incomes.service.ts`, la traducción de rango de fechas: `buildDateRangeFilter(start_date, end_date)` devolviendo el fragmento `{ date: { gte, lte } }` con ambos extremos opcionales
- [x] 2.2 Mover `buildSearchFilter(search)` → `{ concept: { contains: search } }`, **sin `mode`** (no soportado en MySQL)
- [x] 2.3 Mover `buildOrderBy(sort_by, order, defaultOrderBy)` con el defecto parametrizable
- [x] 2.4 Mover `buildPagination(page, limit)` → `{ skip, take, page, limit }` con los defaults `page=1`, `limit=20` aplicados
- [x] 2.5 Mover `paginatedResponse(data, total, page, limit)` → la forma `{ data, total, page, limit }`
- [x] 2.6 Reescribir `incomes.service.ts` para consumir los helpers, sin cambiar su comportamiento observable
- [x] 2.7 **Gate** — ejecutar `npx jest src/incomes` y confirmar que sigue en verde. No continuar si algo falla: el refactor debe ser neutro (design §2)
- [x] 2.8 Ejecutar `npm run build` y `npm run lint`

## 3. Filtro account_id en ambos recursos

- [x] 3.1 Añadir `account_id?` (`@IsOptional`, `@IsInt`) a `src/incomes/dto/filter-incomes.dto.ts`
- [x] 3.2 Aplicar `account_id` al `where` de `IncomesService.findAll`
- [x] 3.3 Añadir un test en `incomes.service.spec.ts` que verifique que `?account_id=2` produce `where: { account_id: 2 }`
- [x] 3.4 **No** añadir `account_id` a la allowlist de `sort_by` — filtrar por cuenta tiene sentido, ordenar por su id no (design §4)

## 4. Andamiaje del módulo expenses

- [x] 4.1 Crear `src/expenses/expenses.module.ts` importando `PrismaModule`, declarando `ExpensesController`, proveyendo y exportando `ExpensesService`
- [x] 4.2 Registrar `ExpensesModule` en los `imports` de `src/app.module.ts`
- [x] 4.3 Comprobar que `npm run build` pasa con el módulo vacío antes de seguir

## 5. DTOs y entity de expenses

- [x] 5.1 Crear `src/expenses/dto/create-expense.dto.ts`: `amount` (`@IsNumber`), `concept` (`@IsString`, `@IsNotEmpty`), `date` (`@IsDateString`), `invoiced` (`@IsBoolean`), `account_id` (`@IsInt`), `tax_ids?` (`@IsOptional`, `@IsArray`, `@IsInt({ each: true })`)
- [x] 5.2 Crear `src/expenses/dto/update-expense.dto.ts` como `PartialType(CreateExpenseDto)`
- [x] 5.3 Crear `src/expenses/dto/filter-expenses.dto.ts` con `start_date`, `end_date`, `search`, `account_id`, `sort_by` (`@IsIn(['date','amount','concept','created_at','id'])`), `order`, `page`, `limit` — mismos validadores que el de incomes
- [x] 5.4 Crear `src/expenses/entities/expense.entity.ts` con la forma del expense, sus `taxes`, y el tipo de la respuesta paginada

## 6. Service de expenses: lecturas

- [x] 6.1 Implementar `findAll(filters)` usando los helpers de `src/common/filters/`, incluyendo `taxes: { include: { tax: true } }` y resolviendo `findMany` y `count` con `this.prisma.$transaction([...])` sobre el mismo `where`
- [x] 6.2 Verificar que el `where` compuesto incluye rango de fechas, `search` y `account_id` cuando vienen
- [x] 6.3 Implementar `findOne(id)` con `findUnique` incluyendo `taxes`, lanzando `NotFoundException` si no existe

## 7. Service de expenses: escrituras

- [x] 7.1 Implementar el helper privado de validación de FKs: `account_id` existe, y `count` de taxes con `id: { in: tax_ids }` coincide con `tax_ids.length`; `BadRequestException` con mensaje concreto si falla
- [x] 7.2 Implementar `create(dto)` con nested write `taxes: { create: tax_ids.map(id => ({ tax_id: id })) }` sobre `expense_taxes`, previa validación de FKs
- [x] 7.3 Implementar `update(id, dto)`: verificar existencia (`404`), validar FKs de los campos presentes, y sincronizar taxes con `deleteMany: {}` + `create` **sólo cuando `dto.tax_ids !== undefined`** — `[]` vacía, `undefined` no toca. No usar un truthy check (design §5)
- [x] 7.4 Implementar `remove(id)`: verificar existencia (`404`) y borrar; confirmar que `expense_taxes` desaparece por el `onDelete: Cascade` del esquema
- [x] 7.5 Envolver las escrituras en un `catch` de `P2003` traducido a `BadRequestException`

## 8. Controller de expenses

- [x] 8.1 Crear `src/expenses/expenses.controller.ts` con `@Controller('expenses')` y **sin `@Public()`**
- [x] 8.2 `@Post()` → `create(@Body() dto: CreateExpenseDto)`
- [x] 8.3 `@Get()` → `findAll(@Query() filters: FilterExpensesDto)`
- [x] 8.4 `@Get(':id')` → `findOne(@Param('id', ParseIntPipe) id: number)`
- [x] 8.5 `@Patch(':id')` → `update(@Param('id', ParseIntPipe) id, @Body() dto: UpdateExpenseDto)`
- [x] 8.6 `@Delete(':id')` → `remove(@Param('id', ParseIntPipe) id: number)`

## 9. Tests

- [x] 9.1 Crear `src/expenses/expenses.service.spec.ts` con un mock de `PrismaService`
- [x] 9.2 Cubrir la traducción de filtros: rango completo, `search`, `account_id`, `sort_by`/`order`, sin parámetros
- [x] 9.3 Cubrir paginación: `page=2&limit=20` → `skip: 20, take: 20`, `total` sale del `count`
- [x] 9.4 Cubrir errores: `404`, `400` por account_id y tax_id inválidos
- [x] 9.5 Cubrir taxes: `[2,3]` reemplaza, `[]` vacía, ausente no toca
- [x] 9.6 Crear controller spec con delegación de handlers
- [x] 9.7 Crear test de paridad income/expense (4 assertions)
- [x] 9.8 57 tests en verde (`src/expenses src/incomes src/common`)

## 10. Verificación end-to-end

- [x] 10.1 `GET /expenses` sin token → `401`
- [x] 10.2 CRUD completo con taxes
- [x] 10.3 Filtro `account_id` en `/expenses` y `/incomes`
- [x] 10.4 Parity: ambas respuestas tienen mismas claves `data, limit, page, total`
- [x] 10.5 Cascade de `expense_taxes` verificado
- [x] 10.6 Borrar expense no borra cuenta ni impuestos
- [x] 10.7 Lint y build pasan

## 11. Cierre

- [x] 11.1 Spec de expenses-crud repasado escenario a escenario
- [x] 11.2 Delta `incomes-crud` con `account_id` cubierto en tests
- [x] 11.3 `add-incomes-crud` ya estaba archivado antes
- [x] 11.4 Nota de balance actualizada en README
