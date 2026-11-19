## Why

Hallazgo de la auditoría de `fix-payroll-rest-ownership` (design.md D8, Q4: se difiere a un change propio). `DELETE /payables/payments/:id` (`removePayment(id)`) y `DELETE /receivables/collections/:id` (`removeCollection(id)`) reciben el usuario y el scope en el controller pero no los usan: el servicio busca el pago/cobro y la cuenta por pagar/cobrar **por id sin filtro de propietario**. Quien tenga el permiso borra el pago de otro propietario y **recalcula `paid_amount` y el estado de su cuenta por pagar/cobrar**.

Además, `product-costs` `product-category-overrides/:id` filtra por `user_id: user.id` e ignora scope `ANY` y `ownerUserId`, con lógica de Prisma en el controller (inconsistencia, no fuga).

## What Changes

- `removePayment` y `removeCollection` reciben `ctx` (primer parámetro obligatorio) y resuelven el registro a través del propietario de la cuenta por pagar/cobrar; un id ajeno responde `404`, antes de cualquier validación de estado.
- Mismo patrón que `PayrollService` (ver `src/payroll/CLAUDE.md`); tests con Prisma falso que evalúa `where` anidados.
- Se evalúa mover `product-category-overrides` a un servicio con `OwnershipContext`.

## Non-goals

- No se añaden columnas ni migraciones.
- Change **sólo propuesto**: sin implementar. Requiere sus propias Open Questions (scope `ANY`, consumidores) antes de implementar.

## Capabilities

### Modified Capabilities
- `data-ownership`: rutas por id de pagos de cuentas por pagar y cobros de cuentas por cobrar heredan la propiedad de su cuenta padre.

## Impact

- `src/payables/*`, `src/receivables/*`, y opcionalmente `src/product-costs/*`. REST: ids ajenos pasan de `200` a `404`.
