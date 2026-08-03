## ADDED Requirements

### Requirement: Alta de empleado

El sistema SHALL exponer `POST /employees`, que crea un empleado a partir de `name`, `role`, `salary_type`, `pay_frequency`, `base_salary`, la configuración de día de pago que corresponda a la periodicidad, `started_at`, y opcionalmente `default_payment_account_id` y `notes`.

`salary_type` MUST ser uno de `FIXED`, `HOURLY`, `COMMISSION`, `MIXED`. `pay_frequency` MUST ser uno de `WEEKLY`, `BIWEEKLY`, `MONTHLY`. `active` MUST tomar el valor `true` por defecto.

#### Scenario: Alta correcta de empleado semanal

- **WHEN** se envía `POST /employees` con `{ "name": "Juan", "role": "Ventas", "salary_type": "FIXED", "pay_frequency": "WEEKLY", "base_salary": 2000, "weekly_pay_day": 5, "started_at": "2026-08-01" }`
- **THEN** el sistema responde `201 Created` con el empleado creado, `active: true` y su `id`

#### Scenario: Cuenta de pago inexistente

- **WHEN** se envía `POST /employees` con `"default_payment_account_id": 9999` y esa cuenta no existe o no es del usuario
- **THEN** el sistema responde `400 Bad Request` indicando que la cuenta no existe, y no crea nada

#### Scenario: Campo desconocido en el body

- **WHEN** se envía `POST /employees` con un body válido más `"salary_secret": 1`
- **THEN** el sistema responde `400 Bad Request` y no crea nada

### Requirement: La configuración de día de pago se valida contra la periodicidad

El sistema SHALL exigir la configuración de día de pago que corresponde a la periodicidad elegida, y MUST rechazar la que no corresponde:

- `pay_frequency = WEEKLY` → `weekly_pay_day` obligatorio, entero de `1` (lunes) a `7` (domingo).
- `pay_frequency = BIWEEKLY` → `biweekly_first_day` y `biweekly_second_day` obligatorios, enteros de `1` a `31`, distintos entre sí.
- `pay_frequency = MONTHLY` → `monthly_pay_day` obligatorio, entero de `1` a `31`.

#### Scenario: Semanal sin día de la semana

- **WHEN** se envía `POST /employees` con `"pay_frequency": "WEEKLY"` y sin `weekly_pay_day`
- **THEN** el sistema responde `400 Bad Request` indicando que `weekly_pay_day` es obligatorio para periodicidad semanal

#### Scenario: Quincenal con un solo día

- **WHEN** se envía `POST /employees` con `"pay_frequency": "BIWEEKLY"`, `"biweekly_first_day": 15` y sin `biweekly_second_day`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Quincenal con los dos días iguales

- **WHEN** se envía `"biweekly_first_day": 15` y `"biweekly_second_day": 15`
- **THEN** el sistema responde `400 Bad Request` indicando que los dos días quincenales deben ser distintos

#### Scenario: Configuración que no corresponde a la periodicidad

- **WHEN** se envía `"pay_frequency": "MONTHLY"`, `"monthly_pay_day": 5` y además `"weekly_pay_day": 5`
- **THEN** el sistema responde `400 Bad Request` indicando que `weekly_pay_day` no aplica a periodicidad mensual

#### Scenario: Día fuera de rango

- **WHEN** se envía `"pay_frequency": "MONTHLY"` y `"monthly_pay_day": 32`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Consultar y listar empleados

El sistema SHALL exponer `GET /employees` y `GET /employees/:id`, protegidos por `employee:read`.

`GET /employees` MUST aceptar los filtros `active`, `pay_frequency` y `search` sobre nombre y puesto, además de `sort_by`, `order`, `page` y `limit`, y MUST devolver la respuesta paginada estándar del proyecto.

Por defecto, sin filtro `active`, MUST devolver tanto activos como inactivos.

#### Scenario: Listar sólo activos

- **WHEN** se pide `GET /employees?active=true`
- **THEN** la respuesta contiene sólo empleados con `active: true`

#### Scenario: Empleado inexistente

- **WHEN** se pide `GET /employees/9999` y no existe
- **THEN** el sistema responde `404 Not Found`

### Requirement: Editar un empleado

El sistema SHALL exponer `PATCH /employees/:id`, que acepta cualquier subconjunto de los campos de alta y revalida la coherencia entre `pay_frequency` y su configuración de día de pago.

Cambiar la periodicidad MUST NOT modificar retroactivamente los pagos de nómina ya generados: cada `PayrollPayment` conserva la periodicidad con la que se generó.

#### Scenario: Cambio de periodicidad

- **WHEN** un empleado semanal con pagos ya generados cambia a `"pay_frequency": "MONTHLY"` con `"monthly_pay_day": 5`
- **THEN** el sistema acepta el cambio, los pagos ya generados conservan su `pay_frequency_snapshot: WEEKLY`, y las siguientes generaciones usan la periodicidad mensual

#### Scenario: Cambio de periodicidad sin la nueva configuración

- **WHEN** un empleado semanal cambia a `"pay_frequency": "MONTHLY"` sin enviar `monthly_pay_day`
- **THEN** el sistema responde `400 Bad Request` y no aplica el cambio

### Requirement: Baja de empleado en vez de borrado

Dar de baja a un empleado SHALL realizarse con `PATCH /employees/:id` estableciendo `active: false` y `ended_at`.

Un empleado con pagos de nómina asociados MUST NOT poder borrarse: `DELETE /employees/:id` MUST responder `409 Conflict` indicando cuántos pagos lo referencian y sugiriendo la baja.

Un empleado inactivo MUST NOT generar pagos de nómina nuevos con fecha programada posterior a su `ended_at`.

#### Scenario: Borrado de empleado con historial

- **WHEN** se envía `DELETE /employees/:id` de un empleado con 12 pagos registrados
- **THEN** el sistema responde `409 Conflict` y no borra nada

#### Scenario: Borrado de empleado sin historial

- **WHEN** se envía `DELETE /employees/:id` de un empleado recién creado sin pagos
- **THEN** el sistema responde `200 OK` y el empleado desaparece

#### Scenario: Empleado dado de baja no genera pagos futuros

- **WHEN** un empleado semanal se marca `active: false` con `ended_at = 2026-08-15` y se ejecuta la generación de nómina de agosto
- **THEN** se generan los pagos programados hasta el 15 de agosto y ninguno posterior

### Requirement: Historial de pagos de un empleado

El sistema SHALL exponer `GET /employees/:id/payments`, que devuelve los pagos de nómina del empleado ordenados por fecha programada descendente, con filtros de rango de fechas y de `status`.

#### Scenario: Historial filtrado por mes

- **WHEN** se pide `GET /employees/3/payments?start_date=2026-08-01&end_date=2026-08-31`
- **THEN** la respuesta contiene los pagos con fecha programada dentro de agosto de 2026, con su estado y sus montos
