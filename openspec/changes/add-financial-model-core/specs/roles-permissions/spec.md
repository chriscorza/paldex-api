## ADDED Requirements

### Requirement: Permisos de los recursos financieros nuevos

El catálogo de permisos SHALL incluir, además de los existentes, los siguientes recursos y acciones:

- `expense_category`: `read`, `create`, `update`, `delete`
- `cogs`: `read`, `create`, `update`, `delete`
- `employee`: `read`, `create`, `update`, `delete`
- `payroll`: `read`, `create`, `update`, `delete`
- `tax_payment`: `read`, `create`, `update`, `delete`
- `report`: `read`

Cada uno de estos permisos SHALL registrarse en sus dos variantes de alcance, `ANY` y `OWN`, salvo `expense_category` con `is_system: true`, cuya administración es global.

La sincronización del catálogo MUST seguir siendo idempotente: arrancar la API varias veces no duplica filas en `permissions`.

#### Scenario: Sincronización del catálogo ampliado

- **WHEN** la API arranca con el catálogo ampliado sobre una base que ya tenía los permisos anteriores
- **THEN** las filas nuevas se crean, las existentes no se duplican, y ningún permiso previo se borra

#### Scenario: Handler sin permiso declarado

- **WHEN** se invoca cualquier endpoint nuevo bajo `/employees`, `/payroll`, `/tax-payments`, `/expense-categories`, `/cogs` o `/reports` con un JWT válido sin el permiso correspondiente
- **THEN** el sistema responde `403 Forbidden` y no ejecuta ninguna consulta de negocio

#### Scenario: Alcance propio en los recursos nuevos

- **WHEN** un usuario con `payroll:read` en alcance `OWN` pide `GET /payroll` y existen pagos de nómina de empleados de otro usuario
- **THEN** la respuesta contiene únicamente los pagos de sus propios empleados

### Requirement: El rol admin recibe los permisos nuevos

Al sincronizar el catálogo, el sistema SHALL otorgar al rol de sistema `admin` todos los permisos nuevos en alcance `ANY`.

La protección antibloqueo existente MUST seguir vigente sin cambios: el rol `admin` MUST conservar siempre `role:update` y `user:assign_role`.

#### Scenario: Admin puede operar los módulos nuevos sin intervención manual

- **WHEN** la API arranca por primera vez con el catálogo ampliado
- **THEN** el rol `admin` tiene los permisos de `expense_category`, `cogs`, `employee`, `payroll`, `tax_payment` y `report` en alcance `ANY`

#### Scenario: El rol user no recibe los permisos nuevos automáticamente

- **WHEN** la API arranca con el catálogo ampliado
- **THEN** el rol de sistema `user` no gana ningún permiso nuevo, y se le asignan explícitamente con `PUT /roles/:id/permissions`
