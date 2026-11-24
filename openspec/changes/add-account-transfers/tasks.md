## 1. Esquema y permisos

- [x] 1.1 `AccountTransfer` en `prisma/schema.prisma` (`from_account_id`, `to_account_id`, `amount`, `date`, `fee_amount` default 0, `fee_expense_id?` único, `notes?`, `user_id`, `created_by?`, timestamps), FKs a cuentas con `RESTRICT`, a gasto con `SET NULL`; `Account.initial_balance_at DateTime?`.
- [x] 1.2 Migración: tablas y columnas, filas de permisos `account_transfer:*` (ANY y OWN) con `INSERT IGNORE`, y grant `OWN` al rol `ai_agent` si existe.
- [x] 1.3 `account_transfer:create|read|update|delete` (+ `OWN`) en `PERMISSION_CATALOG`.

## 2. API de traspasos

- [x] 2.1 Módulo `src/account-transfers/` con servicio y controlador: `GET` (lista con filtros `account_id`, `start_date`, `end_date`, paginada), `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`.
- [x] 2.2 Validaciones (origen ≠ destino, montos, cuentas del dueño, categoría de la comisión) y fechas ancladas a la zona del negocio.
- [x] 2.3 Comisión como `Expense` ligado: crear, editar, borrar en la misma transacción.
- [x] 2.4 `CloseGuard` en crear, editar (fecha anterior y nueva) y borrar.
- [x] 2.5 Pruebas del servicio.

## 3. Saldos

- [x] 3.1 `initial_balance_at` en DTOs de cuenta, entidad y servicio.
- [x] 3.2 `getCashReport`: traspasos, pagos a proveedores, cobros y filtro por `initial_balance_at`.
- [x] 3.3 Pruebas del reporte de efectivo.

## 4. MCP

- [x] 4.1 `src/mcp/tools/transfers.tools.ts` con las cuatro tools; servicio en `McpServices`, módulo importado.
- [x] 4.2 Listas de `mcp-tools.service.spec.ts`.

## 5. App

- [x] 5.1 Recurso `AccountTransfersResource` y tipos.
- [x] 5.2 Cuentas: botón y modal de traspaso, lista de traspasos, saldo calculado, campos de saldo inicial y fecha.
- [x] 5.3 Textos en `es.ts` y `en.ts`.

## 6. Publicación

- [x] 6.1 `CHANGELOG.md` 1.9.0 y `package.json`.
- [ ] 6.2 Desplegar y probar en producción con un traspaso real.
