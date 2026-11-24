## Why

El saldo calculado de cada cuenta (`GET /reports/cash`) no cuadra con la realidad:

```
saldo = initial_balance + ingresos − gastos pagados − nómina pagada − impuestos pagados
```

- **No hay forma de mover dinero entre cuentas.** Las ventas caen en Mercado Pago y los gastos salen
  de BBVA, pero el retiro de Mercado Pago al banco no existe en el sistema. En producción, al
  24/11/2026, Mercado Pago "tiene" $1.24 M y BBVA −$286 mil.
- **El saldo inicial no tiene fecha.** `initial_balance` se suma a toda la historia. El dueño quiere
  empezar limpio el 1/1/2027 con los saldos reales de ese día, pero la historia incompleta de 2025–2026
  seguiría sumándose.
- **Pagos a proveedores y cobros a clientes no mueven el saldo.** `PayablePayment` y
  `ReceivableCollection` tienen `account_id`, pero `getCashReport` no los lee.

## What Changes

- **Nuevo registro de traspasos** (`AccountTransfer`), con CRUD en `/account-transfers`: cuenta origen,
  cuenta destino, monto, fecha, nota y una comisión opcional.
  - Un traspaso **no es ingreso ni gasto**: no aparece en el estado de resultados ni en `cash_items`.
  - La comisión (p. ej. por retirar de Mercado Pago) crea un `Expense` real ligado al traspaso, pagado
    desde la cuenta origen, en la categoría que se indique. Se edita y se borra con el traspaso.
  - Respeta el cierre mensual: no se crea, edita ni borra un traspaso en un mes `CLOSED`.
- **`Account.initial_balance_at`** (opcional): fecha del saldo inicial. Con fecha, el saldo calculado
  sólo suma movimientos desde ese día. Sin fecha, todo sigue como hoy.
- **El saldo calculado suma todo lo que mueve dinero**: ingresos, traspasos recibidos y cobros, menos
  gastos pagados, nómina, impuestos, traspasos enviados y pagos a proveedores.
- **Permisos** `account_transfer:create|read|update|delete` (+ `OWN`). La migración se los otorga, con
  alcance `OWN`, al rol `ai_agent` si existe.
- **MCP**: `transfers_list`, `transfer_create`, `transfer_update` y `transfer_delete`.
- **App**: botón "Traspaso" y lista de traspasos en Cuentas; campos de saldo inicial y su fecha.

## Non-goals

- Conciliación contra estado de cuenta, sincronización bancaria, multimoneda.
- Traspasos entre libros de dueños distintos.
- Saldo a una fecha pasada (`as_of`) en el reporte de efectivo.

## Impact

- `prisma/schema.prisma`: modelo `AccountTransfer`, columna `accounts.initial_balance_at`.
- Nuevo módulo `src/account-transfers/`.
- `src/reports/reports-aggregation.service.ts` (`getCashReport`).
- `src/accounts/` (DTOs, entidad).
- `src/mcp/tools/transfers.tools.ts`, registro y prueba del registro.
- `paldex-app`: página de Cuentas.
