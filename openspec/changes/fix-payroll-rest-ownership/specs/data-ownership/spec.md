## ADDED Requirements

### Requirement: Los pagos de nómina heredan la propiedad de su empleado

Un `PayrollPayment` no tiene `user_id` propio: su propietario SHALL ser el `user_id` de su `employee`. Toda ruta REST de payroll (listado, alta manual, generación, lectura por id, edición, pago y borrado) SHALL resolver el pago o los empleados a través del propietario efectivo del contexto (`ownerUserId ?? userId`) y SHALL NOT operar sobre un pago por `id` sin pasar por ese filtro.

Con scope `OWN`, sólo SHALL ser alcanzable un pago cuyo empleado pertenezca al propietario efectivo. Con scope `ANY`, SHALL ser alcanzable cualquier pago para leer, editar, pagar o borrar, pero el empleado y la cuenta a los que apunta una escritura (alta manual, pago, generación) SHALL pertenecer siempre al propietario efectivo, también con scope `ANY`.

Un `PATCH /payroll/:id` SHALL NOT poder fijar `status: PAID`: marcar un pago como pagado SHALL hacerse por `POST /payroll/:id/pay`, que exige cuenta y fecha.

#### Scenario: Leer el pago de otro propietario devuelve 404

- **WHEN** un usuario A con scope `OWN` ejecuta `GET /payroll/:id` con el id de un pago de un empleado de B
- **THEN** el sistema responde `404 Not Found` con el mismo cuerpo que para un id inexistente

#### Scenario: Pagar el pago de otro propietario no mueve dinero

- **WHEN** un usuario A con scope `OWN` ejecuta `POST /payroll/:id/pay` sobre un pago de B
- **THEN** el sistema responde `404 Not Found`
- **AND** el pago de B conserva su `status`, `paid_at` y `account_id`

#### Scenario: Editar o borrar el pago de otro propietario se rechaza

- **WHEN** un usuario A con scope `OWN` ejecuta `PATCH /payroll/:id` o `DELETE /payroll/:id` sobre un pago `PENDING` de B
- **THEN** el sistema responde `404 Not Found`
- **AND** el pago de B no cambia y no se borra

#### Scenario: El listado sólo contiene pagos del propietario

- **WHEN** A y B con scope `OWN` tienen pagos y A ejecuta `GET /payroll`
- **THEN** la respuesta contiene sólo pagos de empleados de A y `total` refleja ese recuento
- **AND** pasar `employee_id` de un empleado de B devuelve una lista vacía, no sus pagos

#### Scenario: Pagar con una cuenta ajena se rechaza

- **WHEN** un usuario A paga un pago propio indicando el `account_id` de una cuenta de B
- **THEN** el sistema responde `400 Bad Request`
- **AND** el pago sigue `PENDING`

#### Scenario: El alta manual con un empleado ajeno se rechaza

- **WHEN** un usuario A con scope `OWN` ejecuta `POST /payroll` con el `employee_id` de un empleado de B
- **THEN** el sistema responde `404 Not Found` (`Employee not found`) y no se crea ningún pago

#### Scenario: Generar nómina no toca empleados de otro propietario

- **WHEN** un usuario con scope `ANY` ejecuta `POST /payroll/generate`
- **THEN** sólo se crean pagos para empleados de su propietario efectivo

#### Scenario: Administrador con ANY gestiona pagos existentes

- **WHEN** un usuario con scope `ANY` ejecuta `GET /payroll/:id` sobre un pago de otro propietario
- **THEN** el sistema responde `200` con el pago

#### Scenario: Administrador con ANY no pasa a PAID por PATCH

- **WHEN** un usuario con scope `ANY` o `OWN` ejecuta `PATCH /payroll/:id` con `status: PAID` sobre un pago `PENDING` al que tiene acceso
- **THEN** el sistema responde `400 Bad Request` indicando usar `POST /payroll/:id/pay`
- **AND** el pago sigue `PENDING`

#### Scenario: ANY paga un pago ajeno sólo con cuenta del propietario efectivo

- **WHEN** un usuario con scope `ANY` ejecuta `POST /payroll/:id/pay` sobre un pago de B indicando una cuenta que no pertenece al propietario efectivo
- **THEN** el sistema responde `400 Bad Request` y el pago sigue `PENDING`
