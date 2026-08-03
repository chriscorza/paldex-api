# Data Ownership

## Purpose

Aislar los datos financieros por usuario mediante `user_id` en `Account`, `Income` y `Expense`, resolviendo el scope (`OWN`/`ANY`) desde el sistema de permisos y aplicando filtrado automático en cada consulta.

## Requirements

### Requirement: Aislamiento de datos por usuario

Todos los recursos financieros (`accounts`, `incomes`, `expenses`) SHALL estar asociados a un `user_id`. Las consultas de lectura y escritura SHALL filtrar por el propietario cuando el scope efectivo del usuario es `OWN`.

#### Scenario: Usuario solo ve sus propios datos

- **WHEN** dos usuarios A y B tienen scope `OWN` y cada uno tiene sus propias cuentas e ingresos
- **THEN** A ve solo sus datos, B ve solo los suyos, y `total` refleja el recuento filtrado

#### Scenario: Administrador ve todos los datos

- **WHEN** un administrador con scope `ANY` consulta cualquier recurso financiero
- **THEN** ve los datos de todos los usuarios sin filtro de propiedad

#### Scenario: Recurso ajeno es indistinguible de inexistente

- **WHEN** un usuario con scope `OWN` pide por id un recurso que pertenece a otro usuario
- **THEN** el sistema responde `404 Not Found`, idéntico a un id inexistente

#### Scenario: No se puede usar una cuenta ajena

- **WHEN** un usuario con scope `OWN` intenta crear un income o expense con el `account_id` de una cuenta que no le pertenece
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Taxes son comunes

- **WHEN** los usuarios A y B crean movimientos con `tax_ids`
- **THEN** ambos pueden usar los mismos impuestos sin restricción de propiedad
