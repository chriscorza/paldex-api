## Context

`Tax` está en el esquema desde el commit inicial, sin módulo Nest:

```prisma
model Tax {
  id         Int      @id @default(autoincrement())
  name       String
  rate       Float
  created_at DateTime @default(now())
  expenses   ExpenseTax[]
  incomes    IncomeTax[]
  @@map("taxes")
}
```

Dos detalles relevantes:

- **`name` no es `@unique`.** Nada impide hoy dos impuestos llamados "IVA".
- **Los campos de relación van en minúscula** (`expenses`, `incomes`), a diferencia de `Account`, donde están capitalizados. No es un descuido que haya que replicar: aquí se escriben tal cual, `_count: { select: { incomes: true, expenses: true } }`.
- **`IncomeTax` y `ExpenseTax` declaran `onDelete: Cascade`** en su relación con `Tax`. Borrar un impuesto arrastra sus filas puente sin avisar.

El módulo es el más simple de los pendientes: dos campos escalares y ninguna FK saliente. La complejidad está toda en el borrado y en la semántica de `rate`.

## Goals / Non-Goals

**Goals:**

- Catálogo de impuestos gestionable por API, para desbloquear los `tax_ids` de `add-incomes-crud`.
- Semántica de `rate` fijada y validada, no dejada a interpretación de cada cliente.
- Que borrar un impuesto no pueda alterar registros históricos.
- Nombres sin duplicados, para que los desplegables de la UI sean usables.

**Non-Goals:**

- Migrar el esquema (ni `@unique` en `name`, ni `Decimal` en `rate`).
- Versionado histórico de tipos impositivos.
- Calcular importes de impuesto sobre incomes o expenses.
- Impuestos por usuario o por país.

## Decisions

### 1. `rate` es un porcentaje (21 = 21 %), validado entre 0 y 100

El esquema dice `rate Float` y nada más. Hay dos convenciones habituales y ambas son defendibles: porcentaje (`21`) o fracción (`0.21`). **No hay nada en el repo que lo desambigüe** — no hay datos de ejemplo, ni cálculo que consuma el campo, ni comentario en el esquema.

Se fija **porcentaje**, con `@Min(0)` y `@Max(100)`.

*Por qué esta y no la fracción:* es lo que un usuario teclea en un formulario ("IVA: 21"), lo que evita que la UI tenga que multiplicar por 100 para mostrarlo, y hace que un `@Max(100)` sea una validación con sentido. Con la convención de fracción, `@Max(1)` rechazaría un impuesto del 150 % que en algunos regímenes existe, y `0.21` frente a `21` es un error de tecleo que nadie detecta a simple vista.

*Consecuencia crítica:* quien implemente el cálculo de impuestos debe dividir entre 100. Si se elige mal, los importes salen 100 veces mayores. Por eso la decisión queda escrita aquí y hay una tarea para documentarla en el propio DTO como comentario.

*Riesgo:* si ya hay filas en `taxes` con valores tipo `0.21`, este change los deja pasar (0.21 está dentro de 0–100) pero significarían 0,21 %. Hay una tarea de verificación de datos existentes antes de dar el change por bueno.

### 2. La unicidad de `name` se comprueba en el service, no en el esquema

Lo correcto sería `@unique` en `Tax.name` y dejar que MySQL lo garantice. Eso exige migración y, si ya hay duplicados en la tabla, la migración falla y hay que limpiarlos primero.

Se implementa la comprobación en el service (`findFirst` por nombre normalizado antes de escribir) y se deja la restricción de BD para un change posterior.

*Trade-off explícito:* una comprobación en aplicación tiene una carrera — dos peticiones concurrentes pueden crear el mismo nombre. Con el volumen de este proyecto (finanzas personales, un puñado de impuestos creados una vez) es un riesgo teórico. **No se debe presentar como una garantía**: es una comprobación de conveniencia para la UI, no una invariante del sistema. La invariante real requiere el índice único.

### 3. Los nombres se normalizan con `trim()` antes de comparar y de guardar

`"  IVA  "` y `"IVA"` se consideran el mismo nombre, y se almacena la versión recortada.

*Por qué:* el caso real es un copy-paste con espacio de sobra que crea un segundo "IVA" indistinguible en un desplegable. La comparación es además case-insensitive de facto, porque la collation `utf8mb4_0900_ai_ci` de MySQL 8 ya lo es — conviene saber que eso viene de la base de datos, no del código, y que cambiar la collation lo rompería en silencio.

### 4. Borrado protegido: `409` si el impuesto está en uso

`remove(id)` cuenta filas en `income_taxes` y `expense_taxes`; si hay alguna, lanza `ConflictException`.

*Por qué esto importa más aquí que en accounts:* el esquema declara `onDelete: Cascade` en ambas tablas puente. Un `delete` directo **funcionaría sin error** y se llevaría por delante las asociaciones. El resultado sería que facturas históricas pierden su IVA de forma silenciosa y los totales de meses cerrados cambian solos. Es exactamente el tipo de fallo que nadie detecta hasta que cuadra mal un trimestre.

*Alternativa descartada:* permitir el borrado y aceptar la cascada. Rápido de implementar y destructivo de forma irreversible.

*Alternativa aplazada:* soft delete / campo `active`, que permitiría retirar un impuesto del desplegable de alta conservando el histórico. Es casi con seguridad lo que se querrá — un impuesto derogado no se borra, se deja de ofrecer. Requiere migración, así que va en su propio change. Mientras tanto, un impuesto en uso simplemente no se puede borrar.

### 5. Editar el `rate` de un impuesto en uso está permitido

`PATCH /taxes/:id` no bloquea el cambio de `rate` aunque el impuesto esté asociado a registros existentes.

*Por qué:* bloquearlo dejaría el catálogo inmutable en cuanto se usara una vez, lo que es peor. Pero tiene una consecuencia que conviene entender: como no hay versionado de tipos, cambiar el IVA del 21 % al 10 % altera el resultado de cualquier cálculo futuro sobre facturas antiguas. Los registros históricos guardan *qué impuesto* se aplicó, no *a qué tipo*.

*Solución real, fuera de alcance:* congelar el `rate` en la fila de `IncomeTax`/`ExpenseTax` en el momento de asociar. Requiere migración y afecta a `add-incomes-crud` y `add-expenses-crud`. Queda como pregunta abierta.

### 6. Orden por defecto: `name` ascendente

A diferencia de incomes y accounts, que ordenan por fecha descendente, aquí el defecto es alfabético.

*Por qué:* un catálogo se consume para elegir de una lista, no para ver lo último creado. `sort_by` permitido: `name`, `rate`, `created_at`, `id`.

### 7. Contadores sólo en el detalle, mapeados a nombres estables

`GET /taxes/:id` incluye `_count: { select: { incomes: true, expenses: true } }` y el service lo mapea a `incomes_count` / `expenses_count`. El listado no lleva contadores.

Misma decisión y mismas razones que en `add-accounts-crud`: la UI necesita el contador donde está el botón de borrar, y `_count` es un detalle de Prisma que no debe filtrarse al contrato de la API.

## Risks / Trade-offs

- **La semántica de `rate` es una decisión sin respaldo en el código existente** → Si el frontend o algún dato ya asumen fracción, este change introduce una incoherencia silenciosa de factor 100. Mitigación: tarea explícita de inspeccionar la tabla `taxes` en producción antes de mergear, y comentario en el DTO fijando la convención para quien implemente el cálculo.

- **La unicidad de `name` no es una garantía real** → Es una comprobación en aplicación, sujeta a carreras y saltable por cualquier escritura directa a la BD (o por el propio `npx prisma studio`). Mitigación: documentarlo como tal y abrir el change de `@unique` cuando se pueda migrar.

- **Sin versionado de tipos, editar un `rate` reescribe el pasado** → Descrito en la decisión 5. No se mitiga en este change; se deja como pregunta abierta porque la solución toca tres módulos.

- **Un impuesto en uso no se puede borrar ni retirar** → La protección de borrado es correcta, pero deja al usuario sin salida para un impuesto derogado: no puede borrarlo y no puede ocultarlo. La UI seguirá ofreciéndolo en el desplegable para siempre. Es el argumento más fuerte para el change de soft delete, y conviene priorizarlo poco después de este.

- **`rate` es `Float`** → Misma deuda que `amount` en incomes y `balance` en accounts. Un tipo del 21 % almacenado como float no causa problemas por sí solo, pero multiplicado por importes float acumula error. Conviene una migración a `Decimal` que cubra los cuatro campos monetarios del esquema a la vez.

## Migration Plan

Sin migraciones de base de datos — `Tax`, `IncomeTax` y `ExpenseTax` ya existen.

Orden de despliegue:

1. Independiente de los demás changes a nivel de código; puede mergearse en cualquier momento.
2. En la práctica conviene junto con `add-accounts-crud` y antes de ejercitar `add-incomes-crud` de punta a punta, porque sin taxes creables por API no se puede probar el flujo de `tax_ids`.
3. Si `add-incomes-crud` aún no está implementado, este change debe registrar el `ValidationPipe` global en `main.ts`. Tarea 1.1, marcada como condicional.
4. **Antes de mergear**: inspeccionar los datos existentes en `taxes` y confirmar que los `rate` almacenados son porcentajes y no fracciones (decisión 1).

Rollback: revertir el commit. No hay estado persistente nuevo que deshacer.

## Open Questions

- ¿Debe `IncomeTax`/`ExpenseTax` congelar el `rate` aplicado en el momento de la asociación? Es la única forma de que editar un impuesto no reescriba el pasado, pero requiere migración y tocar tres módulos.
- ¿Soft delete o un campo `active` para retirar impuestos derogados sin borrarlos? Muy probablemente sí; la pregunta es si va antes o después de que el frontend consuma el catálogo.
- ¿Tiene sentido un endpoint que devuelva el catálogo completo sin paginar (`GET /taxes/all`) para poblar desplegables? Con un catálogo de 5-10 impuestos, `?limit=100` resuelve el caso sin añadir superficie de API.
