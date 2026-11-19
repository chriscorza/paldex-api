## MODIFIED Requirements

### Requirement: Aislamiento de datos por usuario

Todos los recursos financieros (`accounts`, `incomes`, `expenses`, y cualquier recurso que se añada) SHALL estar asociados a un `user_id`. Las consultas de lectura y escritura SHALL filtrar y escribir por el **propietario efectivo**, que es `ownerUserId` cuando está presente en el contexto y `userId` en caso contrario. Las consultas de lectura y escritura SHALL filtrar por el propietario cuando el scope efectivo del usuario es `OWN`.

La autorización y la propiedad SHALL resolverse por separado: el scope proviene del rol de quien llama, la propiedad proviene del propietario efectivo. Un llamante cuyo contexto trae `ownerUserId` distinto de su `userId` SHALL NOT obtener los permisos de ese propietario.

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

#### Scenario: El propietario efectivo decide dónde cae la fila

- **WHEN** un llamante autorizado escribe con `ownerUserId` distinto de su propio `userId`
- **THEN** la fila se guarda con el `user_id` del propietario efectivo
- **AND** es visible para ese propietario en sus consultas con scope `OWN`

#### Scenario: Actuar en nombre de otro no hereda sus permisos

- **WHEN** un llamante con una llave ligada a otro propietario invoca una operación
- **THEN** el permiso y el scope se resuelven del rol del llamante, no del rol del propietario
- **AND** una operación que el rol del llamante no permite se rechaza aunque el propietario sí la tenga

#### Scenario: Una estructura ajena del propietario es inalcanzable

- **WHEN** un llamante con `ownerUserId = A` referencia una cuenta, categoría o empleado de B
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Taxes son comunes

- **WHEN** los usuarios A y B crean movimientos con `tax_ids`
- **THEN** ambos pueden usar los mismos impuestos sin restricción de propiedad
