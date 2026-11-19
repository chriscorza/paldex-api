## Context

`PayrollPayment` no tiene `user_id`; su propietario es `employee.user_id` (ver `src/payroll/CLAUDE.md`). `OwnershipContext` ya separa quién llama (`userId`, autoriza) de de quién son los libros (`ownerUserId`, vía `effectiveOwnerId`), y ofrece dos filtros: `buildOwnerFilter` (qué se **lee**: vacío con `ANY`) y `buildWriteTargetFilter` (a qué estructuras puede apuntar una **escritura**: propietario efectivo con `OWN` o cuando se actúa en nombre de otro, aunque el scope sea `ANY`).

Estado actual de `PayrollController` / `PayrollService` (auditoría hecha leyendo el código en `HEAD`):

| Ruta | ¿Construye ctx en controller? | ¿Filtra por propietario en servicio? | Veredicto |
|---|---|---|---|
| `GET /payroll` (`findAll`) | sí (default `'OWN'`) | sí, pero sólo `scope === 'OWN'` por mano (`employee.user_id`), no con `buildOwnerFilter` | **correcto**; refactor a helper común |
| `POST /payroll` (`createManual`) | sí | sí: empleado y cuenta con `buildWriteTargetFilter` | **correcto** |
| `POST /payroll/generate` | sí | empleados con `buildOwnerFilter`: bajo `ANY` genera para **todos** los propietarios | **hallazgo**: debería usar `buildWriteTargetFilter` |
| `GET /payroll/:id` | **no** | **no** (`findUnique({ id })`) | **vulnerable** |
| `PATCH /payroll/:id` | **no** | **no** | **vulnerable** |
| `POST /payroll/:id/pay` | **no** | sólo si `ctx` (opcional, sólo MCP); cuenta sin validar en REST | **vulnerable** (mueve dinero) |
| `DELETE /payroll/:id` | **no** | **no** | **vulnerable** |

Consumidores de estos endpoints hoy: la ruta MCP (`payroll_list/create/pay`, ya con ctx); el dashboard `paldex-app` **no** llama `/payroll` (sólo `GET /reports/monthly/payroll`; `PreflightPanel` sólo enlaza a una ruta de UI que aún no existe; la vista real está en el change `add-employees-payroll-view`, sin implementar); no hay cliente Flutter de payroll (`grep` en `~/Development/flutter` sin resultados). Es decir: hoy no hay un consumidor legítimo que dependa de operar sobre pagos ajenos.

## Goals / Non-Goals

**Goals**
- Ninguna ruta REST de payroll alcanza un pago o empleado fuera del alcance del contexto.
- Mismo patrón que `expenses`; cero lógica de propiedad nueva (reusar `ownership.ts`).
- Un id ajeno es indistinguible de uno inexistente.
- Cobertura de tests que falle si alguien vuelve a añadir una ruta por id sin ctx.

**Non-Goals**
- No columna `user_id` en `PayrollPayment` ni migración.
- No corregir otros módulos (sólo listarlos; D8).
- No cambiar transiciones de estado ni la regla de PAID congelado.

## Decisions

### D1 — Cómo obtiene el controller el `ctx`

Mismo patrón que `ExpensesController`: `@Req() request: any` + `@CurrentUser() user`, y

```ts
const ctx: OwnershipContext = { userId: user.id, scope: request.permissionScope || 'OWN' };
```

`PermissionsGuard` siempre rellena `request.permissionScope`, así que el `||` es sólo red de seguridad. Payroll conserva `'OWN'` como fallback (expenses usa `'ANY'`): ante un guard roto, fallar cerrado es lo correcto en una ruta que mueve dinero. Para no repetir el bloque en 7 rutas, un método privado `ctxOf(user, request)` dentro de `PayrollController` (no un decorador de parámetro nuevo: sería infraestructura transversal fuera de alcance; si se quiere, es otro change). `ownerUserId` no se rellena en REST (comportamiento idéntico a hoy: `effectiveOwnerId = userId`); sólo MCP lo trae.

*Alternativa descartada*: un `@OwnershipCtx()` param decorator. Mejor DX, pero toca a todos los controllers para ser coherente; fuera de alcance.

### D2 — Firma del servicio: `ctx` primero y obligatorio

`findOne(ctx, id)`, `update(ctx, id, dto)`, `pay(ctx, id, dto)`, `remove(ctx, id)`, igual que `ExpensesService`. Se elimina el `ctx?` opcional de `pay`: un parámetro opcional de seguridad es exactamente cómo REST quedó sin validar. Al ser obligatorio, TypeScript rompe la compilación en cualquier llamador que lo olvide (incluida `mcp-tools.service.ts`, que sólo cambia el orden de argumentos). Los tests existentes de `payroll.service.spec.ts` se adaptan.

### D3 — Scope OWN vs ANY

| Operación | `OWN` | `ANY` |
|---|---|---|
| Listar / leer por id | sólo pagos cuyo `employee.user_id = effectiveOwnerId` | todos (`buildOwnerFilter` vacío) |
| Editar / borrar por id | sólo los propios | cualquiera (modifica estado de un pago ya existente, no reubica filas) |
| Pagar por id | sólo los propios; cuenta del propietario | cualquiera, pero **la cuenta** debe ser del propietario efectivo si se actúa en nombre de otro (`buildWriteTargetFilter`) |
| Alta manual | empleado y cuenta del propietario | igual: `buildWriteTargetFilter` (ya implementado) |
| Generar | empleados del propietario efectivo | **también** del propietario efectivo (cambio, Q1) |

Criterio: el scope amplía lo que se **lee/administra**, no a qué libros se lanza una fila nueva (misma frase que `ownership.ts`). Un pago ajeno que un `ANY` paga con una cuenta propia no tiene sentido contable, de ahí validar la cuenta contra el propietario efectivo. Detalle fino en Q2.

Mecánica común (helper privado `findOwnedPayment(ctx, id, extra?)`):

```ts
this.prisma.payrollPayment.findFirst({
  where: { id, employee: buildOwnerFilter(ctx) }, // ANY → employee: {} (sin restricción)
  ...extra,
});
```
Luego `update`/`delete` por `id` (el propietario del empleado no cambia dentro de la petición; no hace falta `updateMany`).

### D4 — Status para un id ajeno: 404, no 403

`404 Not Found` con el mismo mensaje que un id inexistente (`Payroll payment not found`). Razones: (1) `data-ownership` ya lo exige («Recurso ajeno es indistinguible de inexistente») y lo cumplen `expenses`, `employees`, etc.; (2) un `403` confirmaría que el id existe y es de otro, permitiendo enumerar ids secuenciales de nómina (dato sensible: sueldos); (3) es lo que ya devuelve la ruta MCP de `pay`. Coste: un `OWN` legítimo que se equivoca de id no sabe si es ajeno — aceptable. El orden de validación importa: **propiedad antes que estado** (409 PAID / transición inválida), si no, un `409 Cannot delete a paid payroll payment` filtraría la existencia de un pago ajeno. Se cubre con un test.

### D5 — Validación de empleado/cuenta contra el propietario efectivo

- `createManual`: ya valida empleado (`404`) y cuenta (`400`) con `buildWriteTargetFilter`. Sin cambio funcional; test cross-owner explícito.
- `update`: `UpdatePayrollPaymentDto` sólo admite `deductions`, `bonuses`, `notes`, `status`; **no hay `employee_id` ni `account_id` que validar**. Basta el filtro de propiedad por id. Una guarda en el test (no en código) asegura que el DTO no gane esos campos sin validación (`it` que enumera las claves del DTO).
- `pay`: la cuenta final (`dto.account_id ?? existing.account_id ?? employee.default_payment_account_id`) se valida **siempre** con `assertAccountInOwnerBooks`, no sólo con `ctx`. Un `default_payment_account_id` heredado de otro libro también cae aquí → `400`.
- `generate`: empleados con `buildWriteTargetFilter(ctx)`.

### D6 — Sin columna `user_id` en `PayrollPayment`

Se mantiene la propiedad por `employee.user_id` (join en cada consulta). Añadir `user_id` desnormalizado daría un `where: { id, user_id }` más simple, pero exige migración + backfill y mantener dos fuentes de verdad (empleado y pago) sin ganar nada para este bug. Se anota como posible endurecimiento futuro. Los índices existentes (`employee_id`) cubren el join; el volumen es de decenas de filas.

### D7 — Hallazgo lateral: `PATCH` puede dejar un pago `PAID` sin cuenta ni fecha

`update` valida la transición `PENDING → PAID` pero no exige `paid_at` ni `account_id`, saltándose `pay`. No es un problema de propiedad (fuera de alcance), pero afecta `payroll_paid`. Se registra como Q3; si el dueño dice sí, es una tarea pequeña (rechazar `status: PAID` en `PATCH` apuntando a `/pay`, mismo estilo que `assertCategoryNotPayroll`).

### D8 — Búsqueda del mismo patrón en otros módulos (sólo se listan)

Se revisaron con `grep` todas las rutas `:id` de `src/*/*.controller.ts`.

| Módulo / ruta | Estado | Notas |
|---|---|---|
| `expenses`, `incomes`, `accounts`, `employees` (+`:id/payments`), `expense-categories`, `recurring-expenses`, `tax-payments`, `cogs`, `product-costs` | OK | ctx + servicio filtrado |
| `payables` `DELETE payments/:id` → `removePayment(id)` | **vulnerable** | el controller recibe `u` y `r` pero no los usa; el servicio busca `payablePayment` y `payable` por id sin owner; borra el pago ajeno y **recalcula `paid_amount`/estado de la cuenta por pagar ajena** |
| `receivables` `DELETE collections/:id` → `removeCollection(id)` | **vulnerable** | mismo patrón |
| `product-costs` `product-category-overrides/:id` | parcial | filtra por `user_id: user.id`, ignora scope `ANY` y `ownerUserId`; lógica de Prisma directa en el controller (no es fuga, sí inconsistencia) |
| `monthly-close` `GET :id` | revisar | recibe ctx; confirmar en el follow-up que el servicio filtra |
| `taxes` | por diseño | impuestos comunes (`data-ownership`: «Taxes son comunes») |
| `roles`, `invitations`, `mcp-keys`, `user` | admin | autorizados por permiso (`role:*`, `mcp_key:*`); fuera de este modelo de propiedad |
| `shopify` `connections/:id/*` | OK aparente | pasan `user.id` al servicio |

Los dos vulnerables de payables/receivables son «trivialmente» el mismo arreglo, pero tocan dinero y estados de otro módulo con sus propios tests; **no se incluyen** aquí para mantener el change revisable (Q4). Se recomienda abrir `fix-payables-receivables-rest-ownership` inmediatamente después.

## Risks / Trade-offs

- **Romper un uso no detectado** (script/Postman del dueño operando sobre ids de otro usuario). Mitigación: el dashboard y Flutter no consumen estos endpoints (verificado por grep) y hoy el sistema es esencialmente de un solo propietario; validar con Q5.
- **`ANY` pasa de generar para todos a generar para uno** — cambio de comportamiento intencional (Q1); si algún flujo administrativo dependía de ello, debe hacerse empleado por empleado (`createManual`) o con un `ctx` delegado.
- **Orden de validación** (propiedad antes que estado): si se invierte en un refactor futuro se reintroduce una fuga de existencia. Cubierto por test (D4).
- **Firma obligatoria** rompe llamadores internos: el compilador los encuentra todos; el único externo al módulo es `McpToolsService`.
- **Mocks que no aplican `where`** dan falsos verdes: por eso la integración usa un Prisma falso en memoria que **sí** evalúa `where` anidados (`employee: { user_id }`), ampliando el de `mcp-attribution.spec.ts` (su `matches` hoy ignora objetos anidados: `v && typeof v === 'object' ? true`). Hay que extenderlo o un `where: { employee: ... }` pasaría siempre.

## Plan de pruebas

- **Unitarias** (`payroll.service.spec.ts`): para `findOne/update/pay/remove`, con `OWN` y pago de otro propietario → `NotFoundException` y **ningún** `update/delete` de Prisma invocado; con `ANY` → resuelve; pago ajeno `PAID` → `404` (no `409`); `pay` con cuenta ajena → `400`; `pay` con `default_payment_account_id` ajeno → `400`; `generate` bajo `ANY` sólo consulta empleados con filtro de propietario efectivo.
- **Integración en memoria** (`payroll-rest-ownership.spec.ts`, estilo `mcp-attribution.spec.ts`): `PayrollController` + `PayrollService` reales sobre Prisma falso con `where` anidado; `permissionScope` simulado por request. Casos negativos cross-owner A↔B para las 7 rutas; caso positivo A sobre lo suyo; `ANY` lee lo de B pero no genera para B; usuario sin ownerUserId se comporta igual que antes (regresión).
- **Regresión MCP**: `mcp-attribution.spec.ts` y `mcp-tools.service.spec.ts` siguen en verde con la firma nueva de `pay`.
- **Guarda estructural**: un test que recorre los métodos HTTP de `PayrollController` (metadata de Nest) y comprueba que cada handler con `:id` recibe `@Req`/`@CurrentUser` (o equivalente), para que una ruta nueva sin ctx falle el build.

## Migration Plan / Despliegue

1. Sin migración de esquema ni datos: despliegue de código solamente; rollback = revertir el commit.
2. Antes: confirmar con el dueño Q5 (¿algún cliente/script usa `/payroll/:id`?).
3. Después, con un usuario `OWN` de prueba (o el dueño con dos cuentas): `GET /payroll/<id de otro>` → `404`; propio → `200`; `POST /payroll/generate` con `ANY` → sólo empleados propios; MCP `payroll_pay` sigue funcionando con la llave re-enlazada.
4. Revisar logs 24 h: un pico de `404` en `/payroll/:id` indicaría un cliente que dependía del comportamiento anterior.

## Open Questions

- **Q1.** `POST /payroll/generate` bajo `ANY`: ¿debe generar sólo para el propietario efectivo (recomendado, tarea 3.3) o conservar «todos los propietarios» para administración global?
- **Q2.** Con `ANY`, ¿se permite **mutar** (editar/pagar/borrar) pagos de otro propietario (recomendado: sí, coherente con la ruta MCP actual) o las mutaciones deben exigir siempre propietario efectivo (más estricto, `buildWriteTargetFilter` también para el pago)? Hoy sólo `ai_agent` y admin tienen `ANY`.
- **Q3.** ¿Se prohíbe `PATCH /payroll/:id` con `status: PAID` (obligando a usar `/pay`) en este mismo change o en uno aparte? (D7)
- **Q4.** ¿Se corrige `payables.removePayment` / `receivables.removeCollection` en este change (+2 tareas pequeñas) o en un change propio inmediato (recomendado)?
- **Q5.** ¿Existe algún script, Postman o integración tuya que llame `/payroll/:id` sobre pagos de **otro** usuario? ¿Existe hoy más de un usuario con scope `OWN` con empleados?
- **Q6.** ¿Prefieres además el endurecimiento de D6 (columna `user_id` en `PayrollPayment`) como change futuro, o basta el join por empleado?
