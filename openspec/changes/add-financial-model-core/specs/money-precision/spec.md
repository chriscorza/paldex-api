## ADDED Requirements

### Requirement: El dinero se almacena en decimal, no en punto flotante

Toda columna que represente un monto de dinero SHALL declararse como `Decimal(14,2)` en `prisma/schema.prisma`. Esto incluye las columnas existentes `Account.balance`, `Account.credit_limit`, `Expense.amount` e `Income.amount`, y toda columna monetaria introducida por este change.

`Tax.rate` MUST permanecer como `Float`: es una tasa, no un monto.

Ninguna operación aritmética sobre montos —suma, resta, multiplicación por cantidad, cálculo de porcentaje— MUST realizarse en `number` de JavaScript antes de persistir el resultado. Las agregaciones MUST hacerse en SQL (`SUM`) o con la aritmética decimal del cliente de Prisma.

#### Scenario: Suma de muchos montos sin deriva

- **WHEN** se suman 1000 gastos de `0.01` cada uno mediante el motor de reportes
- **THEN** el total es exactamente `10.00`, sin residuo de punto flotante

#### Scenario: Costo unitario por cantidad

- **WHEN** se registra un costo de mercancía con `unit_cost = 133.33` y `quantity = 3`
- **THEN** `total_cost` es exactamente `399.99`

#### Scenario: La tasa de impuesto sigue siendo flotante

- **WHEN** se consulta el esquema de `Tax`
- **THEN** `rate` sigue declarado como `Float` y su comportamiento no cambia

### Requirement: La API expone el dinero como número JSON

Las respuestas de la API SHALL serializar todo monto como un número JSON con dos decimales, no como cadena. La conversión `Decimal → number` MUST ocurrir en la capa de proyección de entidades, nunca en el frontend.

El contrato existente MUST NOT cambiar: un cliente que hoy lee `expense.amount` como número sigue leyéndolo como número después de la migración.

#### Scenario: Un gasto existente se lee igual que antes

- **WHEN** se pide `GET /expenses/:id` de un gasto creado antes de la migración con `amount = 89.9`
- **THEN** la respuesta contiene `"amount": 89.9` como número JSON, no `"89.90"` como cadena

#### Scenario: Monto nulo

- **WHEN** una columna monetaria opcional está sin valor
- **THEN** la respuesta contiene `null`, no `0` ni `"0.00"`

### Requirement: Migración de datos monetarios sin pérdida

La migración que convierte las columnas `Float` a `Decimal(14,2)` SHALL preservar el valor de cada fila existente. Después de aplicarla, la suma de cada columna monetaria MUST coincidir con la suma previa redondeada a dos decimales.

#### Scenario: Verificación posterior a la migración

- **WHEN** se aplica la migración sobre una base con gastos, ingresos y cuentas existentes
- **THEN** cada `amount`, `balance` y `credit_limit` conserva su valor redondeado a dos decimales, y ninguna fila queda en `NULL` si antes tenía valor

### Requirement: Porcentajes y márgenes con redondeo declarado

Los porcentajes que devuelven los reportes —márgenes, participaciones, variaciones— SHALL calcularse con aritmética decimal y devolverse redondeados a dos decimales.

Cuando el denominador de un porcentaje es cero, el sistema MUST devolver `null`, no `0` ni infinito.

#### Scenario: Margen sobre ventas cero

- **WHEN** se pide un reporte de un mes sin ningún ingreso y con gastos registrados
- **THEN** `gross_margin_percentage` y `net_margin_percentage` son `null`, y los montos absolutos se calculan normalmente

#### Scenario: Margen normal

- **WHEN** las ventas netas del periodo son `100000.00` y la utilidad bruta `32500.00`
- **THEN** `gross_margin_percentage` es `32.5`
