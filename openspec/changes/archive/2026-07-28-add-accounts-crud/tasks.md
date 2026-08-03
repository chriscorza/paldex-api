## 1. Andamiaje del módulo

- [x] 1.1 **Condicional** — si `add-incomes-crud` aún no está implementado, registrar el `ValidationPipe` global en `src/main.ts` con `{ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }`. Sin él ningún decorador de este change se ejecuta
- [x] 1.2 Crear `src/accounts/accounts.module.ts` importando `PrismaModule`, declarando `AccountsController`, proveyendo y exportando `AccountsService` — mismo patrón que `src/incomes/incomes.module.ts`
- [x] 1.3 Registrar `AccountsModule` en los `imports` de `src/app.module.ts`
- [x] 1.4 Comprobar que `npm run build` pasa con el módulo vacío antes de seguir

## 2. DTOs y entity

- [x] 2.1 Crear `src/accounts/dto/create-account.dto.ts`: `name` (`@IsString`, `@IsNotEmpty`), `balance` (`@IsNumber`), `type` (`@IsEnum(AccountType)` importando el enum de `@prisma/client`), `credit_limit?` (`@IsOptional`, `@IsNumber`, `@Min(0)`)
- [x] 2.2 Crear `src/accounts/dto/update-account.dto.ts` como `PartialType(CreateAccountDto)`
- [x] 2.3 Crear `src/accounts/dto/filter-accounts.dto.ts`: `search?` (`@IsString`), `type?` (`@IsEnum(AccountType)`), `sort_by?` (`@IsIn(['name','balance','type','created_at','id'])`), `order?` (`@IsIn(['asc','desc'])`), `page?` (`@IsInt`, `@Min(1)`), `limit?` (`@IsInt`, `@Min(1)`, `@Max(100)`) — todos con `@IsOptional`
- [x] 2.4 Crear `src/accounts/entities/account.entity.ts` con la forma de la cuenta, los campos `incomes_count`/`expenses_count` para el detalle, y el tipo de la respuesta paginada `{ data, total, page, limit }`

## 3. Service: reglas de negocio

- [x] 3.1 Implementar el helper privado `assertCreditLimitCoherence(type, credit_limit)`: lanza `BadRequestException` si `type === 'CREDIT_CARD'` y no hay `credit_limit`, y si `type !== 'CREDIT_CARD'` y sí lo hay (design §1)
- [x] 3.2 Implementar el helper privado que traduce `FilterAccountsDto` a `Prisma.AccountWhereInput`: `name: { contains: search }` **sin `mode`** (no soportado en MySQL, design §8) y `type` cuando venga
- [x] 3.3 Implementar el helper privado de `orderBy` con defecto `{ created_at: 'desc' }`

## 4. Service: lecturas

- [x] 4.1 Implementar `findAll(filters)` con `where`, `orderBy`, `skip`/`take` (defaults `page=1`, `limit=20`) y `this.prisma.$transaction([findMany, count])` sobre el mismo `where`, devolviendo `{ data, total, page, limit }`. **Sin `_count`** en el listado (design §5)
- [x] 4.2 Implementar `findOne(id)` con `findUnique` incluyendo `_count: { select: { Income: true, Expense: true } }` — **ojo: los nombres de relación van capitalizados**, `incomes`/`expenses` no compila (design, sección Context)
- [x] 4.3 Mapear el `_count` de Prisma a `incomes_count` / `expenses_count` en la respuesta, sin filtrar `_count` al JSON (design §4)
- [x] 4.4 Lanzar `NotFoundException` en `findOne` cuando el id no existe

## 5. Service: escrituras

- [x] 5.1 Implementar `create(dto)` invocando `assertCreditLimitCoherence` antes de escribir
- [x] 5.2 Implementar `update(id, dto)`: verificar existencia (`404`), construir el estado resultante mezclando la fila actual con el DTO, y validar la coherencia contra **ese merge**, no contra el DTO suelto (design §1)
- [x] 5.3 En `update`, cuando `type` pasa de `CREDIT_CARD` a otro tipo, escribir `credit_limit: null` explícitamente (design §2)
- [x] 5.4 Implementar `remove(id)`: verificar existencia (`404`), contar incomes y expenses asociados y lanzar `ConflictException` (409) con el desglose si la suma es mayor que cero (design §3)
- [x] 5.5 Envolver el `delete` en un `catch` que traduzca `P2003` a `ConflictException`, como red de seguridad frente a la carrera TOCTOU

## 6. Controller

- [x] 6.1 Crear `src/accounts/accounts.controller.ts` con `@Controller('accounts')` y **sin `@Public()`** — la autenticación la impone el `AuthGuard` global
- [x] 6.2 `@Post()` → `create(@Body() dto: CreateAccountDto)`
- [x] 6.3 `@Get()` → `findAll(@Query() filters: FilterAccountsDto)`
- [x] 6.4 `@Get(':id')` → `findOne(@Param('id', ParseIntPipe) id: number)`
- [x] 6.5 `@Patch(':id')` → `update(@Param('id', ParseIntPipe) id, @Body() dto: UpdateAccountDto)`
- [x] 6.6 `@Delete(':id')` → `remove(@Param('id', ParseIntPipe) id: number)`

## 7. Tests

- [x] 7.1 Crear `src/accounts/accounts.service.spec.ts` con un mock de `PrismaService` que capture los argumentos de `account.findMany`, `account.count`, `account.findUnique`, `income.count` y `expense.count`
- [x] 7.2 Cubrir la traducción de filtros: `search`, `type`, `sort_by`/`order`, y el caso sin parámetros (defaults `page=1`, `limit=20`, `orderBy created_at desc`)
- [x] 7.3 Cubrir la paginación: `page=2&limit=10` produce `skip: 10, take: 10`, y `total` sale del `count`
- [x] 7.4 Cubrir la regla de `credit_limit`: `CREDIT_CARD` sin límite → `400`; `CASH` con límite → `400`; `CREDIT_CARD` con límite → OK; límite negativo → `400`
- [x] 7.5 Cubrir la regla en `update` contra el estado mezclado: `PATCH { type: 'CREDIT_CARD' }` sobre una cuenta `CASH` sin límite → `400`; `PATCH { type: 'DEBIT_CARD' }` sobre una `CREDIT_CARD` → OK y `credit_limit` queda a `null`
- [x] 7.6 Cubrir la protección de borrado: cuenta con incomes → `409`; cuenta con expenses → `409`; cuenta limpia → OK; `P2003` lanzado por Prisma → `409` y no `500`
- [x] 7.7 Cubrir `404` en `findOne`, `update` y `remove` con ids inexistentes
- [x] 7.8 Verificar en el test de `findOne` que el `_count` de Prisma se mapea a `incomes_count`/`expenses_count` y que `_count` no aparece en la respuesta
- [x] 7.9 Crear `src/accounts/accounts.controller.spec.ts` verificando que cada handler delega en el método correcto del service
- [x] 7.10 Ejecutar `npx jest src/accounts` y dejar la suite en verde

## 8. Verificación end-to-end

- [x] 8.1 Levantar la API y confirmar que `GET /accounts` sin token devuelve `401`
- [x] 8.2 Con un JWT obtenido de `POST /auth/login`, crear una cuenta de cada uno de los cuatro tipos y comprobar que la de crédito exige límite y las demás lo rechazan
- [x] 8.3 Listar con `?search=`, `?type=`, `?sort_by=balance&order=desc` y `?page=2&limit=10`, verificando que `total` es coherente
- [x] 8.4 Crear un income contra una de las cuentas y comprobar que `DELETE /accounts/:id` devuelve `409`; borrar el income y confirmar que entonces el borrado funciona
- [x] 8.5 Comprobar que `GET /accounts/:id` devuelve `incomes_count` y `expenses_count` correctos y que no expone `_count`
- [x] 8.6 Ejecutar `npm run lint` y `npm run build`

## 9. Cierre

- [x] 9.1 Repasar `openspec/changes/add-accounts-crud/specs/accounts-crud/spec.md` escenario a escenario y confirmar que cada uno tiene cobertura automática o verificación manual
- [x] 9.2 Dejar registrada la deuda de `balance` (no se sincroniza con las transacciones, design §Riesgos) donde el equipo la vaya a ver — README o issue — para decidirla antes de que haya datos reales
