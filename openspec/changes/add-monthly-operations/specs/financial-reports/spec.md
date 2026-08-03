## ADDED Requirements

### Requirement: El reporte mensual declara su procedencia

`GET /reports/monthly` SHALL incluir en su respuesta `source: 'SNAPSHOT' | 'DYNAMIC'` y, cuando sea snapshot, la `closed_at` del cierre correspondiente.

Cuando el periodo consultado tiene un `MonthlyClose` en estado `CLOSED`, la respuesta SHALL provenir del snapshot congelado y MUST NOT recalcularse.

Cuando el periodo está abierto o en revisión, la respuesta SHALL calcularse al momento, como hasta ahora.

Esto acota el requisito previo de reportes dinámicos: siguen siendo dinámicos **mientras el mes no esté cerrado**, y el cierre es siempre un acto explícito del usuario.

#### Scenario: Mes abierto sigue siendo dinámico

- **WHEN** se corrige un gasto de un mes abierto y se vuelve a pedir su reporte
- **THEN** el reporte refleja la corrección y declara `source: 'DYNAMIC'`

#### Scenario: Mes cerrado sirve el snapshot

- **WHEN** se pide el reporte de un mes en estado `CLOSED`
- **THEN** la respuesta trae las cifras congeladas con `source: 'SNAPSHOT'` y su `closed_at`

#### Scenario: Mes en revisión sigue siendo dinámico

- **WHEN** se pide el reporte de un mes en estado `REVIEWING`
- **THEN** la respuesta se calcula al momento y declara `source: 'DYNAMIC'`

### Requirement: El desglose de gastos separa fijos de variables

`GET /reports/monthly/expenses-breakdown` y el estado mensual SHALL incluir:

```
fixed_expenses_paid
fixed_expenses_pending
variable_expenses_paid
```

Un gasto SHALL contarse como fijo cuando `is_recurring` es `true`, y como variable en cualquier otro caso.

La suma de `fixed_expenses_paid` y `variable_expenses_paid` MUST igualar el total de gastos pagados que ya reporta `operating_expenses` más los renglones excluidos de la utilidad operativa, sin introducir un total nuevo que se contradiga con los existentes.

#### Scenario: Separación de fijos y variables

- **WHEN** el mes tiene `8000` de renta fija pagada, `700` de internet fijo pendiente y `3000` de compras variables pagadas
- **THEN** el reporte devuelve `fixed_expenses_paid: 8000`, `fixed_expenses_pending: 700` y `variable_expenses_paid: 3000`

#### Scenario: Coherencia con los totales existentes

- **WHEN** se suman los gastos fijos y variables pagados del periodo
- **THEN** el resultado es coherente con los renglones de gasto que el estado mensual ya reportaba, sin doble conteo

### Requirement: El dinero disponible ya no excluye pasivos conocidos

`GET /reports/cash` SHALL restar del disponible las cuentas por pagar no liquidadas ni canceladas:

```
available_cash = total_computed_balance - pending_payroll - pending_taxes - payables_outstanding
```

La respuesta SHALL desglosar `payables_overdue` y `payables_upcoming`, e incluir `receivables_outstanding` como cifra informativa que **no** suma al disponible.

`excluded_liabilities` MUST devolverse como lista vacía: el motivo por el que existía —las cuentas por pagar no modeladas— desaparece con este change.

#### Scenario: El disponible resta lo comprometido

- **WHEN** el saldo calculado es `50000`, con `8000` de nómina pendiente y `30000` de cuentas por pagar
- **THEN** `available_cash` es `12000` y `excluded_liabilities` es una lista vacía

#### Scenario: Cuentas por cobrar informativas

- **WHEN** existen `15000` en cuentas por cobrar pendientes
- **THEN** `receivables_outstanding` es `15000` y `available_cash` no los incluye

#### Scenario: Sin cuentas por pagar

- **WHEN** no existe ninguna cuenta por pagar pendiente
- **THEN** `payables_outstanding` es `0`, `excluded_liabilities` es una lista vacía, y el disponible coincide con el cálculo previo a este change
