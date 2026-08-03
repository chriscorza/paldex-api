## Context

`Expense` e `Income` son gemelos en el esquema. Campo a campo:

```prisma
model Expense {                          model Income {
  id         Int      @id @default(...)    id         Int      @id @default(...)
  amount     Float                         amount     Float
  concept    String                        concept    String
  date       DateTime                      date       DateTime
  invoiced   Boolean                       invoiced   Boolean
  account_id Int                           account_id Int
  created_at DateTime @default(now())      created_at DateTime @default(now())
  account    Account  @relation(...)       account    Account  @relation(...)
  taxes      ExpenseTax[]                  taxes      IncomeTax[]
}                                        }
```

La única diferencia es la tabla puente: `ExpenseTax` frente a `IncomeTax`, ambas con PK compuesta y `onDelete: Cascade` en ambos lados.

Eso convierte este change en un problema de **duplicación**, no de diseño de dominio: el comportamiento ya está especificado y (para cuando esto se implemente) implementado en `add-incomes-crud`. La pregunta real es cuánto compartir y cuánto repetir.

Este change **depende de que `add-incomes-crud` esté implementado**. Reflejar un módulo a medias, o extraer helpers comunes de código que aún está cambiando, es trabajo que hay que rehacer.

## Goals / Non-Goals

**Goals:**

- CRUD de `/expenses` con paridad total de comportamiento con `/incomes`.
- Compartir la lógica de filtrado y paginación sin acoplar los dos módulos.
- Filtro por `account_id` en ambos recursos, que la spec original de incomes no contemplaba.
- Que un cliente pueda escribir un solo componente de tabla que sirva para ingresos y gastos.

**Non-Goals:**

- Una clase base genérica `BaseCrudService<T>` que gobierne ambos módulos.
- Recalcular `Account.balance`.
- Categorías, presupuestos o gastos recurrentes.
- `user_id`, `Decimal`, o cualquier migración de esquema.

## Decisions

### 1. Se comparten los helpers de filtrado, no el CRUD

Se extrae a `src/common/filters/` lo que es literalmente idéntico entre ambos módulos:

- `buildDateRangeFilter(start_date, end_date)` → el fragmento `{ date: { gte, lte } }`
- `buildSearchFilter(search)` → `{ concept: { contains } }`
- `buildOrderBy(sort_by, order, defaults)` → el `orderBy` con su defecto
- `buildPagination(page, limit)` → `{ skip, take, page, limit }` con los defaults aplicados
- `paginatedResponse(data, total, page, limit)` → la forma `{ data, total, page, limit }`

Lo que **no** se comparte: los services, los controllers, los DTOs. Cada módulo mantiene los suyos.

*Por qué esta línea y no más arriba:* una clase base `BaseCrudService<TModel, TCreateDto, TUpdateDto>` eliminaría más duplicación sobre el papel, pero en Prisma cada modelo tiene un tipo de delegado distinto (`prisma.income` y `prisma.expense` no son intercambiables sin genéricos muy incómodos o un `any` que tira la seguridad de tipos por la ventana). El resultado típico es una base que hay que agujerear con excepciones en cuanto el tercer módulo no encaja — y `accounts` y `taxes`, que no tienen ni rango de fechas ni `tax_ids`, ya no encajarían.

*Por qué no cero abstracción:* la traducción de `FilteredInput` a `WhereInput` es la parte con reglas sutiles (rango inclusivo, `contains` sin `mode`, allowlist de `sort_by`). Duplicarla garantiza que uno de los dos módulos acabe con un bug que el otro no tiene.

*Regla práctica:* se comparte lo que es idéntico carácter a carácter y tiene una única definición correcta. Todo lo demás se repite.

### 2. La extracción se hace refactorizando incomes, no copiando desde él

La tarea no es "escribir helpers nuevos para expenses y dejar incomes como está", sino mover el código de incomes a `src/common/` y hacer que incomes lo use. Sólo después se escribe expenses contra esos helpers.

*Por qué importa el orden:* si se copia, incomes y expenses divergen en el primer bugfix, que es exactamente el problema que la extracción pretende evitar. La suite de tests de incomes debe seguir en verde tras el refactor y **antes** de escribir una línea de expenses — es la red que demuestra que el movimiento no cambió comportamiento.

### 3. `account_id` se añade a los filtros de ambos recursos

Es el único punto donde este change toca la spec de `incomes-crud`, y por eso lleva un delta `MODIFIED`.

*Por qué aquí y no en su propio change:* la pantalla natural de la UI es "movimientos de esta cuenta", que necesita el filtro en los dos recursos a la vez. Añadirlo sólo a expenses dejaría una asimetría arbitraria, y separarlo en un tercer change para un `where` de una línea es ceremonia sin valor.

*Nota de secuenciación:* el delta `MODIFIED` de `incomes-crud` asume que ese spec ya está en `openspec/specs/`, lo que ocurre cuando `add-incomes-crud` se archiva. Si se intenta archivar este change antes que aquel, el delta no tendrá contra qué aplicarse.

### 4. `sort_by` con la misma allowlist que incomes

`date`, `amount`, `concept`, `created_at`, `id`. Defecto `date desc`. **No** se añade `account_id` a la lista de ordenables: filtrar por cuenta tiene sentido, ordenar por su id no ordena por nada legible.

### 5. Semántica de `tax_ids` idéntica, incluida la distinción `undefined` / `[]`

`undefined` no toca la relación; `[]` la vacía; una lista la reemplaza. La comprobación debe ser `dto.tax_ids !== undefined`, nunca un truthy check — `[]` es truthy en JavaScript y hay un escenario explícito que exige que vacíe la relación.

Es el mismo footgun señalado en `add-incomes-crud`. Se repite aquí porque es el error más probable al reflejar el módulo, y porque un test que sólo cubra "reemplaza" lo deja pasar.

### 6. Validación de FKs y errores idénticos a incomes

`account_id` y cada `tax_id` se comprueban antes de escribir; `BadRequestException` si fallan, con `catch` de `P2003` como red de seguridad. `NotFoundException` en `findOne`, `update` y `remove`.

*Por qué copiar la decisión en vez de compartir el helper:* la validación de `account_id` sí es idéntica y podría ir a `src/common/`, pero requiere inyectar `PrismaService` en el helper, lo que convierte una función pura en un servicio con dependencias. Con dos usos, el coste supera al beneficio. Si aparece un tercer módulo con FK a `Account`, se extrae entonces.

### 7. Un test de paridad explícito entre ambos recursos

Además de los tests unitarios de cada módulo, se escribe un test que ejerce las mismas operaciones sobre `/incomes` y `/expenses` y compara la forma de las respuestas y los códigos de error.

*Por qué:* la paridad es un requisito de la spec ("Comportamiento consistente entre expenses e incomes") y es exactamente lo que se rompe seis meses después, cuando alguien arregla un `404` en un módulo y no en el otro. Un test que compara los dos lo detecta; dos suites independientes no.

## Risks / Trade-offs

- **Refactorizar incomes mientras otro agente lo implementa** → Este change toca `incomes.service.ts` y `filter-incomes.dto.ts`. Si se empieza antes de que `add-incomes-crud` esté terminado y en verde, hay conflicto garantizado. Mitigación: la dependencia está declarada en el proposal y la tarea 1.1 es un gate explícito — no arrancar hasta que la suite de incomes pase.

- **La extracción de helpers puede introducir regresiones en incomes** → Es código que ya funcionaba. Mitigación: la secuencia de la decisión 2 (mover, verificar en verde, y sólo entonces escribir expenses) y una tarea que exige ejecutar `npx jest src/incomes` después del refactor y antes de continuar.

- **`src/common/` es una carpeta nueva sin convención previa en el repo** → Puede convertirse en el cajón de sastre donde acaba todo lo que no encuentra sitio. Mitigación: se acota a `src/common/filters/` con un propósito único y la regla de la decisión 1 escrita aquí para quien venga después.

- **La duplicación deliberada envejece** → Dos services casi idénticos son dos sitios donde aplicar cada bugfix. Es una decisión consciente frente a una abstracción prematura, no un descuido. El test de paridad (decisión 7) es lo que hace que la divergencia se note pronto. Si aparece un tercer módulo con esta forma, conviene reevaluar.

- **`Account.balance` sigue sin reflejar nada** → Con incomes solo, el problema era abstracto. Con expenses, la app ya tiene todo lo necesario para calcular un saldo real y seguirá mostrando un número escrito a mano que no cuadra con ninguna suma. Es el momento en que la deuda de `add-accounts-crud` pasa de teórica a visible para el usuario final. No se resuelve aquí, pero conviene que sea el siguiente change.

- **`amount` es `Float`** → Misma deuda que en el resto del esquema. Con gastos e ingresos sumándose y restándose, los errores de redondeo empiezan a acumularse en ambos sentidos.

## Migration Plan

Sin migraciones de base de datos — `Expense` y `ExpenseTax` ya existen.

Orden de despliegue:

1. **Requisito previo**: `add-incomes-crud` implementado, mergeado y con su suite en verde.
2. Refactor: mover los helpers de filtrado de incomes a `src/common/filters/`, dejar incomes usándolos, verificar que sus tests siguen pasando.
3. Implementar expenses contra los helpers compartidos.
4. Añadir `account_id` a los filtros de ambos.
5. Al archivar en OpenSpec: `add-incomes-crud` primero, este después — el delta `MODIFIED` lo necesita (decisión 3).

Rollback: revertir el commit. El refactor de incomes y la adición de expenses van juntos, así que revertir deja incomes en su estado anterior funcionando.

## Open Questions

- ¿Merece la pena un endpoint unificado de movimientos (`GET /transactions`) que devuelva incomes y expenses mezclados y ordenados por fecha? Es lo que pide una pantalla de "últimos movimientos", y hacerlo en cliente obliga a paginar dos listas y mezclarlas a mano, que es incorrecto en cuanto hay más de una página. No entra aquí, pero es previsible.
- ¿Debe `invoiced` ser filtrable? Está en ambos modelos y es un booleano obvio de filtrar ("gastos sin factura"), pero no aparece en `FilteredInput`. Se ha dejado fuera por no ampliar el contrato compartido sin necesidad demostrada.
- Con expenses en su sitio, ¿el siguiente change es el saldo calculado de `Account` o el `user_id` transversal? Ambos están bloqueando cosas distintas.
