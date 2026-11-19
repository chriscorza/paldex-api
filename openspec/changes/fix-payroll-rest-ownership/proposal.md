## Why

`PayrollController.findOne`, `update`, `pay` y `remove` no construyen ningún `OwnershipContext`: llaman al servicio sólo con el `id`. `PayrollPayment` no tiene `user_id` (la propiedad viaja por `employee.user_id`), así que ningún filtro se aplica y **cualquiera con el permiso `payroll:read|update|delete` puede leer, editar, pagar o borrar el pago de otro propietario conociendo su id**. `pay` es lo más grave: mueve dinero (cambia estado a `PAID`, fija `account_id` y `paid_at`) y entra en `payroll_paid` del reporte del dueño ajeno.

Sólo la ruta MCP está cubierta: `PayrollService.pay(id, dto, ctx)` valida contra el propietario efectivo, pero `ctx` es opcional y REST no lo pasa. El hallazgo ya quedó registrado como «Known gap» en `src/payroll/CLAUDE.md` y en las notas de `fix-mcp-write-attribution`; este change lo cierra. El patrón correcto ya existe en `expenses`, `incomes`, `accounts`, `employees`, etc. (`ctx` desde `@Req() request.permissionScope` + `@CurrentUser()`, servicio con `buildOwnerFilter`).

La auditoría adicional de `list`, `create` y `generate` (ver design.md, «Auditoría») encontró además: `generate` bajo scope `ANY` crea pagos para los empleados de **todos** los propietarios, y `pay` sin `ctx` no valida que la cuenta sea del propietario.

## What Changes

- `PayrollController` construye `OwnershipContext` en **todas** sus rutas (`findOne`, `update`, `pay`, `remove` hoy no lo hacen) y lo pasa al servicio.
- `PayrollService.findOne/update/pay/remove` reciben `ctx` como **primer parámetro obligatorio** (mismo orden que `expenses`) y resuelven el pago con `where: { id, employee: ownerFilter }`. Un id ajeno responde **`404 Not Found`**, idéntico a uno inexistente (requisito ya vigente en `data-ownership`).
- `pay(ctx, id, dto)` deja de tener `ctx` opcional: la cuenta (explícita, la del pago o la predeterminada del empleado) se valida siempre contra el propietario efectivo con `buildWriteTargetFilter`.
- `generate` elige empleados con un filtro estricto del propietario efectivo: un `ANY` ya no genera nómina de otros propietarios (Q1, resuelta; ver «Decisiones cerradas» en design.md).
- `PATCH /payroll/:id` ya no admite `status: PAID` (debe usarse `/pay`) (Q3, resuelta).
- Scope: `OWN` filtra por propietario efectivo; `ANY` lee/gestiona cualquier pago (lectura y mutación de estado), pero **toda estructura a la que apunta una escritura** (empleado, cuenta) debe ser del propietario efectivo.
- Tests: unitarios en `payroll.service.spec.ts`, e integración en memoria `payroll-rest-ownership.spec.ts` (mismo estilo que `mcp-attribution.spec.ts`) con casos negativos cross-owner contra el controlador real.
- Se actualiza `src/payroll/CLAUDE.md` (se elimina el «Known gap») y `src/mcp/CLAUDE.md`.

## Non-goals

- No se arregla `payables.removePayment` / `receivables.removeCollection` ni los demás hallazgos de la auditoría: se listan en design.md y se proponen como changes aparte (ver D8).
- No se añade `user_id` a `PayrollPayment` ni migración de esquema (D6).
- No se cambia la máquina de estados de payroll ni la regla «PAID congelado».
- No se toca `taxes` (comunes por diseño) ni el contrato de las tools MCP.

## Capabilities

### New Capabilities
_Ninguna._

### Modified Capabilities
- `data-ownership`: se añade el requisito de que los recursos sin `user_id` propio (pagos de nómina) heredan la propiedad de su empleado y que **toda** ruta REST por id, listado, alta y generación lo respeta.

## Impact

- **Código modificado**: `src/payroll/payroll.controller.ts`, `src/payroll/payroll.service.ts` (firmas de `findOne/update/pay/remove`, `generate`), `src/mcp/mcp-tools.service.ts` (sólo el orden de argumentos de `pay`), `src/payroll/CLAUDE.md`, `src/mcp/CLAUDE.md`.
- **Tests**: `src/payroll/payroll.service.spec.ts` (se adapta a firmas nuevas), nuevo `src/payroll/payroll-rest-ownership.spec.ts`, `src/mcp/mcp-attribution.spec.ts` (regresión).
- **Schema / migraciones**: ninguna.
- **BREAKING (REST)**: un usuario con scope `OWN` que hoy opere sobre un pago ajeno recibirá `404` en `GET/PATCH/DELETE /payroll/:id` y `POST /payroll/:id/pay` (antes `200`). Un `ANY` que llamaba `POST /payroll/generate` verá que sólo se generan pagos de empleados de su propio libro. Consumidores: el dashboard `paldex-app` **no consume hoy** `/payroll` (sólo `GET /reports/monthly/payroll`; la vista de nómina está planeada en `add-employees-payroll-view`, aún sin implementar) y no se encontró cliente Flutter de payroll; el único consumidor real es la ruta MCP, cuyo comportamiento no cambia. Para un usuario legítimo sobre sus propios pagos no hay cambio de contrato.
- **BREAKING (REST)**: `PATCH /payroll/:id` con `status: PAID` pasa a `400` (usar `POST /payroll/:id/pay`).
- **Ops**: ningún paso previo de datos; verificación post-despliegue descrita en design.md.
