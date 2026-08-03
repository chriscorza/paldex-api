## 1. Andamiaje del módulo

- [x] 1.1 **Condicional** — si `add-incomes-crud` aún no está implementado, registrar el `ValidationPipe` global en `src/main.ts` con `{ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }`
- [x] 1.2 **Antes de nada** — inspeccionar la tabla `taxes` con `npx prisma studio` y confirmar que los `rate` existentes son porcentajes (21) y no fracciones (0.21). Si son fracciones, parar y replantear la decisión §1 del design antes de seguir
- [x] 1.3 Crear `src/taxes/taxes.module.ts` importando `PrismaModule`, declarando `TaxesController`, proveyendo y exportando `TaxesService`
- [x] 1.4 Registrar `TaxesModule` en los `imports` de `src/app.module.ts`
- [x] 1.5 Comprobar que `npm run build` pasa con el módulo vacío antes de seguir

## 2. DTOs y entity

- [x] 2.1 Crear `src/taxes/dto/create-tax.dto.ts`: `name` (`@IsString`, `@IsNotEmpty`), `rate` (`@IsNumber`, `@Min(0)`, `@Max(100)`)
- [x] 2.2 Añadir en el DTO un comentario que fije la convención: `rate` es un **porcentaje** (21 = 21 %), no una fracción — quien calcule importes debe dividir entre 100 (design §1)
- [x] 2.3 Crear `src/taxes/dto/update-tax.dto.ts` como `PartialType(CreateTaxDto)`
- [x] 2.4 Crear `src/taxes/dto/filter-taxes.dto.ts`: `search?` (`@IsString`), `sort_by?` (`@IsIn(['name','rate','created_at','id'])`), `order?` (`@IsIn(['asc','desc'])`), `page?` (`@IsInt`, `@Min(1)`), `limit?` (`@IsInt`, `@Min(1)`, `@Max(100)`) — todos con `@IsOptional`
- [x] 2.5 Crear `src/taxes/entities/tax.entity.ts` con la forma del impuesto, los campos `incomes_count`/`expenses_count` para el detalle, y el tipo de la respuesta paginada

## 3. Service: unicidad y filtros

- [x] 3.1 Implementar el helper privado `assertNameAvailable(name, excludeId?)`: normaliza con `trim()`, busca un impuesto con ese nombre excluyendo `excludeId`, y lanza `ConflictException` si lo encuentra (design §2, §3)
- [x] 3.2 Asegurar que `assertNameAvailable` recibe `excludeId` en `update`, para que renombrar un impuesto a su propio nombre no dé `409`
- [x] 3.3 Implementar el helper privado que traduce `FilterTaxesDto` a `Prisma.TaxWhereInput`: `name: { contains: search }` **sin `mode`** (no soportado en MySQL)
- [x] 3.4 Implementar el helper privado de `orderBy` con defecto `{ name: 'asc' }` — alfabético, no por fecha (design §6)

## 4. Service: lecturas

- [x] 4.1 Implementar `findAll(filters)` con `where`, `orderBy`, `skip`/`take` (defaults `page=1`, `limit=20`) y `this.prisma.$transaction([findMany, count])` sobre el mismo `where`, devolviendo `{ data, total, page, limit }`. Sin `_count` en el listado
- [x] 4.2 Implementar `findOne(id)` con `findUnique` incluyendo `_count: { select: { incomes: true, expenses: true } }` — aquí los nombres de relación van **en minúscula**, a diferencia de `Account`
- [x] 4.3 Mapear el `_count` de Prisma a `incomes_count` / `expenses_count`, sin filtrar `_count` al JSON
- [x] 4.4 Lanzar `NotFoundException` en `findOne` cuando el id no existe

## 5. Service: escrituras

- [x] 5.1 Implementar `create(dto)`: `trim()` del nombre, `assertNameAvailable`, y escritura
- [x] 5.2 Implementar `update(id, dto)`: verificar existencia (`404`), `assertNameAvailable(name, id)` si viene `name`, y escribir el nombre recortado
- [x] 5.3 Confirmar que `update` **no** bloquea el cambio de `rate` aunque el impuesto esté en uso (design §5)
- [x] 5.4 Implementar `remove(id)`: verificar existencia (`404`), contar filas en `income_taxes` y `expense_taxes` y lanzar `ConflictException` (409) con el desglose si hay alguna (design §4)
- [x] 5.5 Verificar explícitamente que la ruta de borrado protegido **nunca** llega al `delete` de Prisma cuando el impuesto está en uso — el `onDelete: Cascade` del esquema borraría las asociaciones sin error

## 6. Controller

- [x] 6.1 Crear `src/taxes/taxes.controller.ts` con `@Controller('taxes')` y **sin `@Public()`**
- [x] 6.2 `@Post()` → `create(@Body() dto: CreateTaxDto)`
- [x] 6.3 `@Get()` → `findAll(@Query() filters: FilterTaxesDto)`
- [x] 6.4 `@Get(':id')` → `findOne(@Param('id', ParseIntPipe) id: number)`
- [x] 6.5 `@Patch(':id')` → `update(@Param('id', ParseIntPipe) id, @Body() dto: UpdateTaxDto)`
- [x] 6.6 `@Delete(':id')` → `remove(@Param('id', ParseIntPipe) id: number)`

## 7. Tests

- [x] 7.1 Crear `src/taxes/taxes.service.spec.ts` con un mock de `PrismaService` que cubra `tax.findMany`, `tax.count`, `tax.findUnique`, `tax.findFirst`, `tax.create`, `tax.update`, `tax.delete`, `incomeTax.count` y `expenseTax.count`
- [x] 7.2 Cubrir la validación de `rate`: 0 → OK, 7.5 → OK, 21 → OK, 150 → `400`, -5 → `400`
- [x] 7.3 Cubrir la unicidad: nombre duplicado en `create` → `409`; nombre con espacios sobrantes que colisiona → `409`; renombrado a un nombre ocupado → `409`; renombrado al propio nombre → OK
- [x] 7.4 Verificar que el nombre se guarda recortado (`trim`) tanto en `create` como en `update`
- [x] 7.5 Cubrir la traducción de filtros: `search`, `sort_by`/`order`, y el caso sin parámetros (defaults `page=1`, `limit=20`, `orderBy name asc`)
- [x] 7.6 Cubrir la paginación: `page=2&limit=10` produce `skip: 10, take: 10`, y `total` sale del `count`
- [x] 7.7 Cubrir la protección de borrado: impuesto usado por incomes → `409`; usado por expenses → `409`; sin uso → OK. Verificar que `tax.delete` **no se invoca** en los dos primeros casos
- [x] 7.8 Cubrir `404` en `findOne`, `update` y `remove` con ids inexistentes
- [x] 7.9 Verificar en el test de `findOne` que `_count` se mapea a `incomes_count`/`expenses_count` y no aparece en la respuesta
- [x] 7.10 Crear `src/taxes/taxes.controller.spec.ts` verificando que cada handler delega en el método correcto del service
- [x] 7.11 Ejecutar `npx jest src/taxes` y dejar la suite en verde

## 8. Verificación end-to-end

- [x] 8.1 Levantar la API y confirmar que `GET /taxes` sin token devuelve `401`
- [x] 8.2 Con un JWT válido, crear "IVA" al 21 % e intentar crear un segundo "IVA" y un "  IVA  ", comprobando que ambos dan `409`
- [x] 8.3 Listar con `?search=`, `?sort_by=rate&order=desc` y `?page=2&limit=10`, verificando que `total` es coherente y que el orden por defecto es alfabético
- [x] 8.4 Asociar el impuesto a un income vía `POST /incomes` con `tax_ids`, y comprobar que `DELETE /taxes/:id` devuelve `409`
- [x] 8.5 **Crítico** — tras el `409` del paso anterior, verificar en `npx prisma studio` que las filas de `income_taxes` **siguen existiendo**. Es la comprobación que demuestra que la cascada no se ha disparado (design §4)
- [x] 8.6 Borrar el income y confirmar que entonces sí se puede borrar el impuesto
- [x] 8.7 Comprobar que `GET /taxes/:id` devuelve `incomes_count` y `expenses_count` correctos y no expone `_count`
- [x] 8.8 Ejecutar `npm run lint` y `npm run build`

## 9. Cierre

- [x] 9.1 Repasar `openspec/changes/add-taxes-crud/specs/taxes-crud/spec.md` escenario a escenario y confirmar cobertura automática o verificación manual
- [x] 9.2 Dejar registradas las dos deudas abiertas donde el equipo las vea: la unicidad de `name` no está garantizada en BD (design §2) y editar un `rate` altera cálculos sobre registros históricos (design §5)
