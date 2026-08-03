## 1. Validación global y DTOs

- [x] 1.1 Registrar `ValidationPipe` global en `src/main.ts` con `{ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }`, antes del `app.listen`
- [x] 1.2 Escribir `src/incomes/dto/create-income.dto.ts` con `amount` (`@IsNumber`), `concept` (`@IsString`, `@IsNotEmpty`), `date` (`@IsDateString`), `invoiced` (`@IsBoolean`), `account_id` (`@IsInt`) y `tax_ids?` (`@IsOptional`, `@IsArray`, `@IsInt({ each: true })`)
- [x] 1.3 Verificar que `src/incomes/dto/update-income.dto.ts` hereda de `PartialType(CreateIncomeDto)` y que `tax_ids` sigue siendo distinguible entre ausente y `[]`
- [x] 1.4 Crear `src/incomes/dto/filter-incomes.dto.ts` como clase `implements FilteredInput`: `start_date`/`end_date` (`@IsOptional`, `@IsDateString`), `search` (`@IsOptional`, `@IsString`), `sort_by` (`@IsOptional`, `@IsIn(['date','amount','concept','created_at','id'])`), `order` (`@IsOptional`, `@IsIn(['asc','desc'])`), `page` (`@IsOptional`, `@IsInt`, `@Min(1)`), `limit` (`@IsOptional`, `@IsInt`, `@Min(1)`, `@Max(100)`)
- [x] 1.5 Definir en `src/incomes/entities/income.entity.ts` el tipo de income con `taxes` y el tipo de la respuesta paginada `{ data, total, page, limit }`
- [x] 1.6 Comprobar que `npm run build` pasa (Docker compila sin errores; `tsc --noEmit` limpio)

## 2. Service: lecturas y traducción de filtros

- [x] 2.1 Añadir a `IncomesService` un helper privado que traduzca `FilterIncomesDto` a `Prisma.IncomeWhereInput`: `date` con `gte`/`lte` según `start_date`/`end_date`, y `concept: { contains: search }` sin `mode` (no soportado en MySQL — ver design §4)
- [x] 2.2 Añadir un helper privado que traduzca `sort_by`/`order` a `orderBy`, con defecto `{ date: 'desc' }`
- [x] 2.3 Reescribir `findAll(filters)` para aplicar `where`, `orderBy`, `skip: (page-1)*limit` y `take: limit` (defaults `page=1`, `limit=20`), incluir `taxes: { include: { tax: true } }` y devolver `{ data, total, page, limit }` resolviendo `findMany` y `count` con `this.prisma.$transaction([...])` sobre el mismo `where`
- [x] 2.4 Implementar `findOne(id)` con `findUnique` incluyendo `taxes`, lanzando `NotFoundException` si no existe

## 3. Service: escrituras

- [x] 3.1 Añadir un helper privado que valide FKs: `account_id` existe, y `count` de taxes con `id: { in: tax_ids }` coincide con `tax_ids.length`; lanzar `BadRequestException` con mensaje concreto si falla
- [x] 3.2 Implementar `create(dto)` con nested write `taxes: { create: tax_ids.map(id => ({ tax_id: id })) }`, previa validación de FKs, devolviendo el income con sus taxes
- [x] 3.3 Implementar `update(id, dto)`: verificar existencia (`404`), validar FKs de los campos presentes, y sincronizar taxes con `deleteMany: {}` + `create` **sólo cuando `dto.tax_ids !== undefined`** — `[]` debe vaciar la relación, `undefined` debe dejarla intacta (design §6)
- [x] 3.4 Implementar `remove(id)`: verificar existencia (`404`) y borrar; confirmar que `income_taxes` desaparece por el `onDelete: Cascade` del esquema
- [x] 3.5 Envolver las escrituras en `catch` de `P2003` traducido a `BadRequestException` como red de seguridad frente a la carrera TOCTOU (design §7)

## 4. Controller

- [x] 4.1 Eliminar el decorador `@Public()` del `IncomesController` — incluido el que quedó colgando sobre el bloque comentado del `@Post()`
- [x] 4.2 Reemplazar `findAll` para que reciba `@Query() filters: FilterIncomesDto` y lo delegue al service, borrando el `IncomeWhereInput` vacío hardcodeado
- [x] 4.3 Añadir `@Post()` → `create(@Body() dto: CreateIncomeDto)`
- [x] 4.4 Añadir `@Get(':id')` → `findOne(@Param('id', ParseIntPipe) id: number)`
- [x] 4.5 Añadir `@Patch(':id')` → `update(@Param('id', ParseIntPipe) id, @Body() dto: UpdateIncomeDto)`
- [x] 4.6 Añadir `@Delete(':id')` → `remove(@Param('id', ParseIntPipe) id: number)`
- [x] 4.7 Borrar los bloques de código comentados que quedaron en el controller

## 5. Tests

- [x] 5.1 Ampliar `src/incomes/incomes.service.spec.ts` con un mock de `PrismaService` que capture los argumentos pasados a `income.findMany`
- [x] 5.2 Cubrir la traducción de filtros: rango completo de fechas, sólo `start_date`, `search`, `sort_by`/`order`, y el caso sin parámetros (defaults `page=1`, `limit=20`, `orderBy date desc`)
- [x] 5.3 Cubrir la paginación: `page=2&limit=20` produce `skip: 20, take: 20`, y `total` sale del `count`, no del `length` de `data`
- [x] 5.4 Cubrir los errores: `404` en `findOne`/`update`/`remove` inexistentes, `400` por `account_id` inválido y por `tax_id` inválido
- [x] 5.5 Cubrir la sincronización de taxes: `tax_ids: [2,3]` reemplaza, `tax_ids: []` vacía, `tax_ids` ausente no toca la relación
- [x] 5.6 Ampliar `src/incomes/incomes.controller.spec.ts` para verificar que cada handler delega en el método correcto del service
- [x] 5.7 Ejecutar `npx jest src/incomes` y dejar la suite en verde

## 6. Verificación end-to-end

- [x] 6.1 Levantar la API (`npm run start:dev` o docker compose) y confirmar que `GET /incomes` sin token devuelve `401`
- [x] 6.2 Obtener un JWT con `POST /auth/login` y recorrer el ciclo completo: crear un income con taxes, listarlo con filtros, consultarlo por id, actualizarlo y borrarlo
- [x] 6.3 Confirmar que `POST /auth/login` y `POST /auth/user` siguen funcionando con el `ValidationPipe` global activo (riesgo de `forbidNonWhitelisted` — design §9)
- [x] 6.4 Verificar en phpMyAdmin o `npx prisma studio` que las filas de `income_taxes` se crean, se reemplazan y se borran en cascada como corresponde
- [x] 6.5 Ejecutar `npm run lint` y `npm run build`

## 7. Cierre

- [x] 7.1 Anotar en el README o en un comentario de `paldex-app/src/API/IncomesResource.tsx` que `GET /incomes` ahora devuelve `{ data, total, page, limit }` y exige `Authorization: Bearer` — el frontend deberá leer `.data` y hacer login real contra `/auth/login` cuando se conecte
- [x] 7.2 Repasar la spec `openspec/changes/add-incomes-crud/specs/incomes-crud/spec.md` escenario a escenario y confirmar que cada uno tiene cobertura o verificación manual
