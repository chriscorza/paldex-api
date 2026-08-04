## ADDED Requirements

### Requirement: Crear payable con DTO validado

El sistema SHALL exponer `POST /payables` que acepta un body validado contra `CreatePayableDto`. Los campos no declarados en el DTO MUST ser rechazados con `400 Bad Request`.

Campos requeridos: `vendor` (string no vacío), `concept` (string no vacío), `total_amount` (número positivo), `due_date` (ISO 8601 date string).

Campos opcionales: `account_id` (integer positivo), `notes` (string).

#### Scenario: Creación correcta

- **WHEN** se envía `POST /payables` con `{ "vendor": "Proveedor X", "concept": "Factura 123", "total_amount": 5000, "due_date": "2025-03-15" }`
- **THEN** el sistema responde `201 Created` con el payable creado, `paid_amount: 0` y `user_id` del usuario autenticado

#### Scenario: Campo desconocido rechazado

- **WHEN** se envía `POST /payables` con un body válido más `"user_id": 99`
- **THEN** el sistema responde `400 Bad Request` y no crea ningún registro

#### Scenario: total_amount negativo o cero

- **WHEN** se envía `POST /payables` con `"total_amount": 0` o `"total_amount": -100`
- **THEN** el sistema responde `400 Bad Request`

### Requirement: Actualizar payable con DTO validado y whitelist

El sistema SHALL exponer `PATCH /payables/:id` que acepta un body validado contra `UpdatePayableDto`. Todos los campos MUST ser opcionales. El service MUST construir un objeto `updateData` solo con los campos provistos, sin pasar el body crudo a Prisma.

Campos actualizables: `vendor`, `concept`, `total_amount`, `due_date`, `account_id`, `notes`.

#### Scenario: Actualización parcial con whitelist

- **WHEN** se envía `PATCH /payables/1` con `{ "vendor": "Nuevo nombre" }`
- **THEN** solo el campo `vendor` se actualiza; `paid_amount`, `user_id` y otros campos protegidos no se modifican

#### Scenario: Campo no whitelisteado se ignora

- **WHEN** se envía `PATCH /payables/1` con `{ "vendor": "X", "paid_amount": 99999 }`
- **THEN** `vendor` se actualiza pero `paid_amount` conserva su valor original (no se pasa a Prisma)

### Requirement: Crear receivable con DTO validado

El sistema SHALL exponer `POST /receivables` que acepta un body validado contra `CreateReceivableDto`. Los campos no declarados en el DTO MUST ser rechazados con `400 Bad Request`.

Campos requeridos: `customer` (string no vacío), `concept` (string no vacío), `total_amount` (número positivo), `due_date` (ISO 8601 date string).

Campos opcionales: `related_income_id` (integer positivo), `notes` (string).

#### Scenario: Creación correcta

- **WHEN** se envía `POST /receivables` con `{ "customer": "Cliente Y", "concept": "Servicio Q1", "total_amount": 10000, "due_date": "2025-03-20" }`
- **THEN** el sistema responde `201 Created` con el receivable creado, `collected_amount: 0` y `user_id` del usuario autenticado

### Requirement: Actualizar receivable con DTO validado y whitelist

El sistema SHALL exponer `PATCH /receivables/:id` que acepta un body validado contra `UpdateReceivableDto`. Todos los campos MUST ser opcionales. El service MUST construir un objeto `updateData` solo con los campos provistos.

Campos actualizables: `customer`, `concept`, `total_amount`, `due_date`, `related_income_id`, `notes`.

#### Scenario: Actualización parcial con whitelist

- **WHEN** se envía `PATCH /receivables/1` con `{ "customer": "Nuevo cliente" }`
- **THEN** solo `customer` se actualiza; `collected_amount`, `user_id` y otros campos protegidos no se modifican

### Requirement: Eliminar un cobro de receivable

El sistema SHALL exponer `DELETE /receivables/collections/:id` que elimina un cobro (`ReceivableCollection`) por su id. El endpoint MUST verificar que el receivable padre pertenece al usuario autenticado.

#### Scenario: Eliminación exitosa

- **WHEN** se envía `DELETE /receivables/collections/5` y el cobro 5 pertenece a un receivable del usuario
- **THEN** el sistema responde `200 OK` y el cobro deja de existir

#### Scenario: Cobro no encontrado

- **WHEN** se envía `DELETE /receivables/collections/9999` y ese cobro no existe
- **THEN** el sistema responde `404 Not Found`

#### Scenario: Cobro de receivable ajeno

- **WHEN** un usuario con scope `OWN` intenta eliminar un cobro de un receivable que pertenece a otro usuario
- **THEN** el sistema responde `404 Not Found`
