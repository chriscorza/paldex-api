## 1. Servicio: propiedad por id

- [ ] 1.1 Añadir helper privado `findOwnedPayment(ctx, id, extra?)` en `PayrollService` con `findFirst({ where: { id, employee: buildOwnerFilter(ctx) } })`; lanza `NotFoundException('Payroll payment not found')`.
- [ ] 1.2 Cambiar `findOne`, `update`, `pay`, `remove` a `(ctx, id, ...)` con `ctx: OwnershipContext` obligatorio; resolver siempre vía el helper y comprobar propiedad **antes** que estado (409/transición).
- [ ] 1.3 `pay`: validar la cuenta final (`dto.account_id ?? existing.account_id ?? employee.default_payment_account_id`) con `assertAccountInOwnerBooks` siempre, no sólo con `ctx`; eliminar la rama `if (ctx)`.
- [ ] 1.4 `findAll`: sustituir el `if (ctx.scope === 'OWN')` manual por `employee: buildOwnerFilter(ctx)` (mismo resultado, un solo mecanismo).
- [ ] 1.5 `generate`: elegir empleados con el filtro estricto `ownerBooks(ctx)` (`{ user_id: effectiveOwnerId(ctx) }`) en lugar de `buildOwnerFilter(ctx)` (Q1). `createManual` y la cuenta de `pay` usan el mismo `ownerBooks` (Q2).
- [ ] 1.6 `update`: rechazar `status: PAID` con `BadRequestException` que apunte a `POST /payroll/:id/pay`, tras la comprobación de propiedad (Q3).

## 2. Controller

- [ ] 2.1 Añadir `ctxOf(user, request)` privado en `PayrollController` (`scope: request.permissionScope || 'OWN'`) y usarlo en las 7 rutas.
- [ ] 2.2 `findOne`, `update`, `pay`, `remove` reciben `@Req()` y `@CurrentUser()` y pasan `ctx` al servicio.
- [ ] 2.3 Ajustar `McpToolsService` al nuevo orden de argumentos de `pay(ctx, id, dto)`; confirmar que sigue pasando el contexto con `ownerUserId`.

## 3. Tests unitarios (`payroll.service.spec.ts`)

- [ ] 3.1 Adaptar los tests existentes de `update`, `pay`, `remove` y `findOne` a las firmas nuevas.
- [ ] 3.2 `OWN` + pago de otro propietario → `404` en `findOne/update/pay/remove`, sin llamadas a `payrollPayment.update/delete`.
- [ ] 3.3 Pago ajeno `PAID` con `OWN` → `404` (no `409`): la propiedad se comprueba antes que el estado.
- [ ] 3.4 `ANY` resuelve un pago de otro propietario; `pay` con cuenta ajena → `400`; `pay` con `default_payment_account_id` ajeno → `400`.
- [ ] 3.5 `generate` bajo `ANY` consulta empleados con filtro de propietario efectivo; el caso `OWN` no cambia.
- [ ] 3.6 Guarda de DTO: `UpdatePayrollPaymentDto` no declara `employee_id` ni `account_id` (si se añaden, el test obliga a validarlos).
- [ ] 3.7 `update` con `status: PAID` → `400` (nada se escribe); otras transiciones (`CANCELLED`) siguen; pago ajeno con `status: PAID` bajo `OWN` → `404` (no `400`).
- [ ] 3.8 `createManual` y `generate` bajo `ANY` sin delegar sólo aceptan empleado/cuenta del propietario efectivo.

## 4. Integración en memoria (`payroll-rest-ownership.spec.ts`)

- [ ] 4.1 Extender el Prisma falso para evaluar `where` anidados (`employee: { user_id }`); sin esto el test pasa en falso. Verificar que el `matches` actual no se reutiliza tal cual.
- [ ] 4.2 `PayrollController` + `PayrollService` reales; `permissionScope` y `user.id` simulados por petición.
- [ ] 4.3 Negativos cross-owner A→B con `OWN`: `GET /:id`, `PATCH /:id`, `POST /:id/pay`, `DELETE /:id` → `404`; el pago de B queda intacto (estado, `paid_at`, `account_id`, fila existente).
- [ ] 4.4 `GET /payroll` de A no incluye pagos de B ni siquiera con `employee_id` de B; `POST /payroll` con empleado de B → `404`; con cuenta de B → `400`.
- [ ] 4.8 `PATCH /payroll/:id` con `status: PAID` → `400` por REST; el pago no cambia.
- [ ] 4.5 Positivos: A lee/edita/paga/borra lo suyo; `ANY` lee el pago de B (`200`); `ANY` no genera nómina para empleados de B.
- [ ] 4.6 Regresión: REST sin `ownerUserId` se comporta igual que antes para el propio dueño; `mcp-attribution.spec.ts` y `mcp-tools.service.spec.ts` en verde.
- [ ] 4.7 Guarda estructural: test que recorre los handlers de `PayrollController` con `:id` y falla si alguno no recibe usuario/request (ruta nueva sin ctx).

## 5. Documentación

- [ ] 5.1 `src/payroll/CLAUDE.md`: eliminar el «Known gap», documentar propiedad por `employee.user_id`, `404` para ajeno y orden propiedad→estado.
- [ ] 5.2 `src/mcp/CLAUDE.md`: actualizar la tabla tool↔REST si cambia algo observable; nota de que REST y MCP comparten ahora el mismo camino de validación.
- [ ] 5.3 Registrar en `fix-mcp-write-attribution` (Implementation notes) que el hallazgo queda resuelto por este change.
- [ ] 5.4 Crear (como change aparte, sin implementar) `fix-payables-receivables-rest-ownership` con los hallazgos de design.md D8 (Q4: confirmado que no se tocan aquí).

## 6. Verificación y despliegue

- [ ] 6.1 `npm test` y `npm run lint`; `openspec validate fix-payroll-rest-ownership --strict` (leer también las líneas INFO).
- [x] 6.2 Resolver Q1–Q6 con el dueño y reflejar las respuestas en design.md («Decisiones cerradas») antes de implementar.
- [ ] 6.3 En producción tras desplegar: verificar `404` cross-owner, `200` propio y `payroll_pay` por MCP con la llave re-enlazada.
- [ ] 6.4 Revisar logs 24 h en busca de `404` inesperados en `/payroll/:id`.
