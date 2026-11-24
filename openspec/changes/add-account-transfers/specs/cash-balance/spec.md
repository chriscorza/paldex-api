# Cash Balance

## MODIFIED Requirements

### Requirement: Saldo calculado de cada cuenta

`GET /reports/cash` SHALL calcular el saldo de cada cuenta como:

```
initial_balance
+ ingresos + traspasos recibidos + cobros de cuentas por cobrar
− gastos pagados − nómina pagada − impuestos pagados − traspasos enviados − pagos de cuentas por pagar
```

Si la cuenta tiene `initial_balance_at`, SHALL sumar sólo los movimientos con fecha mayor o igual a ese
día (ingreso: `date`; gasto: `paid_at` o `date`; nómina e impuestos: `paid_at`; traspaso: `date`; pago
a proveedor: `paid_at`; cobro: `collected_at`). Sin `initial_balance_at`, SHALL sumar todos.

#### Scenario: Traspaso entre cuentas

- **WHEN** hay un traspaso de 50,000 de Mercado Pago a BBVA
- **THEN** el saldo calculado de Mercado Pago baja 50,000, el de BBVA sube 50,000 y el total disponible no cambia

#### Scenario: Saldo inicial con fecha

- **WHEN** BBVA tiene `initial_balance = 80,000` con `initial_balance_at = 2027-01-01`, y gastos pagados en 2026 y en enero de 2027
- **THEN** el saldo calculado es 80,000 menos sólo los gastos de 2027

#### Scenario: Pagos a proveedores y cobros

- **WHEN** se paga 5,000 a un proveedor desde BBVA y se cobran 2,000 a un cliente en Efectivo
- **THEN** el saldo de BBVA baja 5,000 y el de Efectivo sube 2,000

### Requirement: Saldo inicial con fecha

Las cuentas SHALL aceptar `initial_balance_at` opcional al crear y al editar (`YYYY-MM-DD`, anclado a la
medianoche de la zona del negocio), y SHALL devolverlo en la entidad de cuenta.

#### Scenario: Capturar el saldo de arranque

- **WHEN** el dueño edita BBVA con `initial_balance = 80,000` e `initial_balance_at = 2027-01-01`
- **THEN** la cuenta guarda ambos valores y el reporte de efectivo los usa
