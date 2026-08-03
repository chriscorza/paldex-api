## ADDED Requirements

### Requirement: Moneda, actividad y saldo inicial de la cuenta

`Account` SHALL tener `currency`, `is_active` e `initial_balance`.

`POST /accounts` MUST aceptar los tres como opcionales, con estos valores por defecto: `currency = 'MXN'`, `is_active = true`, `initial_balance = balance`.

`currency` MUST ser un código de tres letras en mayúsculas. Este change MUST rechazar cualquier valor distinto de `MXN`, coherente con la restricción de moneda ya vigente en la integración de Shopify: no hay conversión de divisas en el sistema.

`PATCH /accounts/:id` MUST aceptar `is_active` e `initial_balance`; `currency` MUST NOT poder cambiarse una vez que la cuenta tiene movimientos.

#### Scenario: Crear una cuenta con valores por defecto

- **WHEN** se envía `POST /accounts` con el body actual, sin `currency`, `is_active` ni `initial_balance`, y `"balance": 10000`
- **THEN** la cuenta queda con `currency: 'MXN'`, `is_active: true` e `initial_balance: 10000`

#### Scenario: Moneda no soportada

- **WHEN** se envía `POST /accounts` con `"currency": "USD"`
- **THEN** el sistema responde `400 Bad Request` indicando que sólo se admite `MXN`, y no crea nada

#### Scenario: Cambiar la moneda de una cuenta con movimientos

- **WHEN** se envía `PATCH /accounts/:id` con `"currency": "MXN"` sobre una cuenta que ya tiene ingresos asociados
- **THEN** el sistema responde `400 Bad Request` indicando que la moneda no se modifica en una cuenta con movimientos

#### Scenario: Saldo inicial explícito distinto del saldo actual

- **WHEN** se envía `POST /accounts` con `"balance": 32000` e `"initial_balance": 10000`
- **THEN** la cuenta guarda ambos valores, y el reporte de caja usa `initial_balance` como punto de partida del cálculo

### Requirement: Desactivar una cuenta en vez de borrarla

Una cuenta con movimientos asociados MUST poder desactivarse con `PATCH /accounts/:id` estableciendo `is_active: false`. La protección de borrado existente MUST seguir vigente.

Una cuenta inactiva MUST NOT sumar al dinero disponible del reporte de caja, y MUST NOT poder elegirse como cuenta de pago de un gasto, de un pago de nómina ni de un pago de impuestos nuevo.

Los movimientos históricos de una cuenta inactiva MUST seguir contando en los reportes del periodo al que pertenecen.

#### Scenario: Desactivar una cuenta con movimientos

- **WHEN** se envía `PATCH /accounts/2` con `{ "is_active": false }` sobre una cuenta con ingresos y gastos
- **THEN** el sistema responde `200 OK`, la cuenta queda inactiva y sus movimientos históricos permanecen intactos

#### Scenario: Usar una cuenta inactiva como cuenta de pago

- **WHEN** se envía `POST /payroll/7/pay` con `"account_id"` de una cuenta inactiva
- **THEN** el sistema responde `400 Bad Request` indicando que la cuenta está inactiva

#### Scenario: La cuenta inactiva no suma al disponible

- **WHEN** se pide `GET /reports/cash` con una cuenta inactiva de saldo `5000`
- **THEN** `total_computed_balance` no incluye esos `5000`, y la cuenta aparece en la respuesta marcada como inactiva

### Requirement: Filtro de actividad en el listado de cuentas

`GET /accounts` SHALL aceptar el filtro `is_active`. Sin ese filtro, MUST devolver tanto activas como inactivas, preservando el comportamiento actual.

#### Scenario: Listar sólo cuentas activas

- **WHEN** se pide `GET /accounts?is_active=true`
- **THEN** la respuesta contiene sólo cuentas activas

#### Scenario: Listado sin filtro

- **WHEN** se pide `GET /accounts`
- **THEN** la respuesta contiene todas las cuentas del usuario, activas e inactivas

### Requirement: Migración de las cuentas existentes

La migración de este change SHALL asignar a toda cuenta existente `currency = 'MXN'`, `is_active = true` e `initial_balance = balance`.

Ninguna cuenta existente MUST cambiar de `name`, `balance`, `credit_limit`, `type` ni `user_id`.

#### Scenario: Cuenta histórica migrada

- **WHEN** se migra una cuenta existente con `balance: 32000`
- **THEN** queda con `initial_balance: 32000`, `is_active: true`, `currency: 'MXN'` y su `balance` intacto

#### Scenario: El reporte de caja de una cuenta histórica

- **WHEN** se pide `GET /reports/cash` justo después de la migración
- **THEN** `computed_balance` de esa cuenta es `initial_balance` más los movimientos registrados, y `drift` expone la diferencia contra el `balance` capturado a mano
