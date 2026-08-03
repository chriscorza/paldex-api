## Context

`Account` está en `prisma/schema.prisma` desde el commit inicial y no tiene módulo Nest. Es la pieza que falta para que el resto del dominio funcione: `Income.account_id` y `Expense.account_id` son FKs obligatorias.

Detalles del esquema que condicionan el diseño:

```prisma
model Account {
  id           Int      @id @default(autoincrement())
  name         String
  balance      Float
  credit_limit Float?
  type         AccountType
  created_at   DateTime @default(now())
  Expense      Expense[]
  Income       Income[]
  @@map("accounts")
}
```

- **Los campos de relación están capitalizados**: `Expense` e `Income`, no `expenses`/`incomes`. El cliente Prisma generado expone esos nombres tal cual, así que un `_count: { select: { incomes: true } }` **no compila**. Hay que escribir `Income` y `Expense`. Es el footgun principal de este módulo.
- **Las relaciones no declaran `onDelete`.** Para una relación obligatoria, el default de Prisma es `Restrict`: borrar una cuenta con transacciones falla a nivel de base de datos. Eso es lo que queremos, pero el error crudo (`P2003`) no le dice nada útil al cliente.
- `balance` es un valor **almacenado**, no derivado. Nada en el esquema lo ata a la suma de incomes y expenses.

El resto de convenciones vienen de `add-incomes-crud`: `AuthGuard` global, `ValidationPipe` global, respuesta paginada `{ data, total, page, limit }`, allowlist de `sort_by`, servicios que hablan con Prisma sin capa de repositorio.

## Goals / Non-Goals

**Goals:**

- Cinco endpoints CRUD en `/accounts`, todos autenticados, consistentes con el patrón de incomes.
- Reglas de negocio de `AccountType` y `credit_limit` aplicadas de forma coherente tanto en creación como en actualización parcial.
- Borrado seguro: nunca perder transacciones por borrar una cuenta.
- Contadores de uso en `GET /accounts/:id` para que la UI pueda avisar antes de intentar borrar.

**Non-Goals:**

- Derivar o recalcular `balance` desde las transacciones.
- Migrar `Float` a `Decimal`.
- Añadir `user_id` a `Account`.
- Cualquier concepto de saldo disponible, conciliación o histórico de balances.

## Decisions

### 1. La coherencia `type` ↔ `credit_limit` se valida en el service, no en el DTO

`class-validator` tiene `@ValidateIf`, que resolvería el caso de `POST` en el DTO. Pero en `PATCH` la regla debe evaluarse contra el **estado resultante** de la cuenta, y el DTO sólo ve los campos enviados: un `PATCH { type: 'CREDIT_CARD' }` sobre una cuenta sin `credit_limit` es inválido, y el DTO por sí solo no puede saberlo porque no conoce la fila actual.

Se implementa un único helper privado en el service — `assertCreditLimitCoherence(type, credit_limit)` — que recibe los valores finales y se invoca desde `create` (con el DTO) y desde `update` (con el merge de la fila actual y el DTO).

*Por qué una sola regla en un solo sitio:* tener la mitad de la validación en decoradores y la otra mitad en el service es cómo se acaba con `POST` y `PATCH` aceptando cosas distintas. El DTO valida forma (tipos, enum, rangos); el service valida negocio.

*Alternativa descartada:* un validador custom de clase (`@ValidatorConstraint`) con acceso asíncrono a la BD. `class-validator` lo soporta, pero meter consultas dentro de la capa de validación oculta I/O donde nadie lo espera y complica el testing.

### 2. Cambiar `type` a un tipo sin crédito pone `credit_limit` a `null`

Cuando un `PATCH` mueve la cuenta de `CREDIT_CARD` a cualquier otro tipo, el service escribe `credit_limit: null` explícitamente aunque el cliente no lo haya mandado.

*Por qué:* la alternativa es rechazar el cambio con un `400` exigiendo `"credit_limit": null` explícito, lo que obliga al cliente a conocer la regla. Dejar el límite huérfano tampoco vale: una cuenta `CASH` con `credit_limit: 2000` es un estado sin sentido que tarde o temprano alguien lee y usa. Limpiarlo es la opción que no deja basura.

### 3. Protección de borrado: comprobación previa + red de seguridad

`remove(id)` cuenta incomes y expenses de la cuenta; si la suma es mayor que cero, lanza `ConflictException` (409) con el desglose. Además, el `delete` va envuelto en un `catch` que traduce `P2003` a `ConflictException`.

*Por qué 409 y no 400:* la petición está bien formada y el recurso existe; lo que falla es el estado del servidor. `409 Conflict` es exactamente eso.

*Por qué la doble protección:* la comprobación previa da el mensaje útil (“3 incomes y 5 expenses lo impiden”); el `catch` cubre la carrera en la que alguien crea un income entre el `count` y el `delete`. Sin él, esa carrera es un `500`.

*Alternativa descartada:* borrado en cascada (`onDelete: Cascade` en el esquema). Borrar una cuenta destruiría su historial financiero entero de forma silenciosa. Para un gestor de finanzas personales eso es inaceptable, y además requeriría migración.

*Alternativa aplazada:* soft delete (`deleted_at`), que permitiría archivar cuentas conservando el histórico. Es probablemente lo que se querrá al final, pero exige migración y tocar los filtros de todos los módulos. Fuera de alcance.

### 4. Los contadores se exponen como `incomes_count` / `expenses_count`, no como `_count`

Prisma devuelve `_count: { Income: 3, Expense: 5 }` con los nombres de relación capitalizados. El service mapea eso a `incomes_count: 3, expenses_count: 5` en la entity antes de responder.

*Por qué:* los nombres capitalizados son un accidente de cómo se escribió el esquema, no un contrato de API. Filtrarlos al JSON obligaría al frontend a escribir `account._count.Income`, y ataría la API a un detalle del esquema que quizá se renombre.

### 5. `_count` sólo en `GET /accounts/:id`, no en el listado

El detalle incluye contadores; el listado no.

*Por qué:* `_count` en un listado paginado añade una subconsulta agregada por fila. Con 20 cuentas por página es asumible, pero es coste que nadie ha pedido — la UI necesita el contador en la pantalla de detalle, que es donde está el botón de borrar. Si el listado acaba necesitándolo, se añade entonces.

### 6. Filtro `type` validado contra el enum de Prisma

`FilterAccountsDto.type` usa `@IsEnum(AccountType)` importando el enum de `@prisma/client`, igual que el DTO de creación.

*Por qué importar el enum en vez de duplicar los literales:* si mañana se añade `SAVINGS` al esquema, la validación se actualiza sola al regenerar el cliente. Duplicar la lista garantiza que se desincronice.

### 7. `sort_by` restringido a `name`, `balance`, `type`, `created_at`, `id`

Misma decisión que en incomes y por la misma razón: un `sort_by` libre pasa columnas arbitrarias a `orderBy` y convierte cualquier typo en un `500`. Por defecto, `created_at desc`.

### 8. Búsqueda con `contains` sin `mode`

`mode: 'insensitive'` no existe en el conector MySQL de Prisma — es exclusivo de PostgreSQL y MongoDB. La insensibilidad la aporta la collation por defecto de MySQL 8 (`utf8mb4_0900_ai_ci`). Misma decisión y mismo riesgo asumido que en `add-incomes-crud`.

## Risks / Trade-offs

- **`balance` no se sincroniza con las transacciones** → Es la deuda más grave que deja este change. Un cliente puede crear una cuenta con `balance: 1000`, registrar 5.000 € en incomes, y el `balance` seguirá diciendo 1000. La API no ofrece ninguna forma de saber cuál de los dos números es cierto. Mitigación a corto plazo: documentar que `balance` es el saldo inicial declarado por el usuario, no un saldo calculado. Solución real, en su propio change: o bien recalcularlo transaccionalmente en cada escritura de income/expense, o bien dejar de almacenarlo y derivarlo con una agregación. La segunda es más limpia y evita estados imposibles; la primera es más rápida de leer. Conviene decidirlo **antes** de que haya datos reales.

- **Nombres de relación capitalizados (`Income`, `Expense`)** → Un `select: { incomes: true }` no compila, y es un error fácil de cometer viniendo del resto del código, donde todo es snake_case. Mitigación: está documentado arriba, hay una tarea específica para verificarlo con `npm run build` y los tests mockean la forma exacta que devuelve Prisma.

- **La comprobación previa de borrado tiene una ventana TOCTOU** → Cubierta por el `catch` de `P2003` (decisión 3). El peor caso es un mensaje menos detallado, no un borrado indebido.

- **Cuentas globales, no por usuario** → Igual que los incomes: cualquier usuario autenticado ve y edita las cuentas de todos. Exigir JWT da apariencia de aislamiento sin darlo. Debe resolverse en un change de `user_id` que cubra `Account`, `Income` y `Expense` a la vez — hacerlo por módulos sueltos deja el modelo a medias.

- **`balance` y `credit_limit` son `Float`** → Errores de redondeo acumulativos en valores monetarios. Fuera de alcance aquí, pero es la misma deuda señalada en `add-incomes-crud` para `amount`; conviene una migración a `Decimal` que cubra los tres campos de golpe.

## Migration Plan

Sin migraciones de base de datos — `Account` y `AccountType` ya existen en el esquema.

Orden de despliegue:

1. Este change puede mergearse antes o después de `add-incomes-crud`; no dependen entre sí a nivel de código.
2. En la práctica conviene **antes**, porque sin cuentas creables por API no se puede ejercitar `POST /incomes` de punta a punta.
3. Si `add-incomes-crud` aún no está implementado, este change debe registrar el `ValidationPipe` global en `main.ts` — sin él los decoradores de los DTOs no se ejecutan y toda la validación de este spec es papel mojado. La tarea 1.1 está marcada como condicional.

Rollback: revertir el commit. No hay estado persistente nuevo que deshacer.

## Open Questions

- ¿`balance` debería ser de sólo lectura tras la creación, y modificarse únicamente por efecto de las transacciones? Este change permite editarlo libremente por `PATCH`, que es lo consistente con el esquema actual, pero refuerza el problema de deriva descrito en los riesgos.
- ¿Hace falta un endpoint de saldo calculado (`GET /accounts/:id/balance`) que devuelva la suma real de incomes menos expenses? Sería la vía menos invasiva para exponer el número correcto sin decidir todavía qué hacer con la columna almacenada.
- ¿Debe `DELETE /accounts/:id` devolver `200` con el objeto borrado o `204 No Content`? La spec asume `200` con el objeto, por coherencia con lo decidido en `add-incomes-crud`.
