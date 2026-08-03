## ADDED Requirements

### Requirement: Catálogo de categorías de gasto de dos niveles

El sistema SHALL modelar cada categoría de gasto con un `type` financiero y un `name` específico dentro de ese tipo.

Los tipos válidos SHALL ser: `COGS`, `OPERATING`, `PAYROLL`, `TAX`, `SHOPIFY_FEES`, `SHIPPING`, `MARKETING`, `DEBT`, `OWNER`, `OTHER`.

La combinación `(name, type)` MUST ser única por usuario propietario.

#### Scenario: Crear una categoría

- **WHEN** se envía `POST /expense-categories` con `{ "name": "Renta local", "type": "OPERATING" }`
- **THEN** el sistema responde `201 Created` con la categoría creada, `is_system: false` y las banderas de reporte derivadas de su tipo

#### Scenario: Tipo inválido

- **WHEN** se envía `POST /expense-categories` con `"type": "MISCELANEO"`
- **THEN** el sistema responde `400 Bad Request` enumerando los tipos válidos, y no crea nada

#### Scenario: Nombre duplicado dentro del mismo tipo

- **WHEN** se crea una categoría `{ "name": "Renta local", "type": "OPERATING" }` y ya existe una idéntica del mismo propietario
- **THEN** el sistema responde `409 Conflict` y no crea un duplicado

#### Scenario: Mismo nombre en tipos distintos

- **WHEN** existe `{ "name": "Comida", "type": "OPERATING" }` y se crea `{ "name": "Comida", "type": "OWNER" }`
- **THEN** el sistema responde `201 Created`, porque son categorías distintas

### Requirement: El tipo financiero determina el renglón del estado de resultados

Cada categoría SHALL exponer tres banderas que definen cómo el motor de reportes trata los gastos que la usan:

- `affects_gross_profit`: el gasto se resta antes de la utilidad bruta.
- `affects_operating_profit`: el gasto se resta antes de la utilidad operativa.
- `is_cash_outflow`: el gasto reduce el saldo de la cuenta que lo paga.

Los valores por defecto SHALL derivarse del tipo:

| Tipo | `affects_gross_profit` | `affects_operating_profit` | `is_cash_outflow` |
|---|---|---|---|
| `COGS` | `false` | `false` | `true` |
| `OPERATING` | `false` | `true` | `true` |
| `PAYROLL` | `false` | `true` | `true` |
| `TAX` | `false` | `true` | `true` |
| `SHOPIFY_FEES` | `true` | `true` | `true` |
| `SHIPPING` | `true` | `true` | `true` |
| `MARKETING` | `false` | `true` | `true` |
| `DEBT` | `false` | `true` | `true` |
| `OWNER` | `false` | `false` | `true` |
| `OTHER` | `false` | `true` | `true` |

El sistema MUST permitir sobreescribir estas banderas al crear o editar una categoría, para los casos que el tipo no captura —notablemente el pago de capital de una deuda, que no es gasto.

`COGS` lleva `affects_gross_profit: false` deliberadamente: un gasto de tipo `COGS` es una **compra de inventario**, y el renglón COGS del estado de resultados se calcula desde `CostOfGoodsSold` casado contra ventas. Ver la capacidad `cogs-tracking`.

#### Scenario: Banderas derivadas del tipo

- **WHEN** se crea una categoría con `"type": "MARKETING"` sin especificar banderas
- **THEN** la categoría queda con `affects_gross_profit: false`, `affects_operating_profit: true`, `is_cash_outflow: true`

#### Scenario: Pago de capital de deuda no es gasto

- **WHEN** se crea `{ "name": "Pago capital tarjeta", "type": "DEBT", "affects_operating_profit": false }`
- **THEN** el sistema acepta la sobreescritura, y los gastos de esa categoría reducen caja pero no utilidad operativa

#### Scenario: Retiro del dueño no reduce utilidad operativa

- **WHEN** se registra un gasto pagado en una categoría de tipo `OWNER`
- **THEN** el reporte mensual lo excluye de gastos operativos y lo muestra en el bloque de retiros y reinversión, y sí lo resta de la caja

### Requirement: Categorías de sistema sembradas y protegidas

Al iniciar el módulo, el sistema SHALL asegurar la existencia de las categorías mínimas de MVP marcadas con `is_system: true`:

`Compra de mercancía` (`COGS`), `Renta local` (`OPERATING`), `Servicios` (`OPERATING`), `Software y herramientas` (`OPERATING`), `Transporte y viáticos` (`OPERATING`), `Nómina salario` (`PAYROLL`), `Nómina bono` (`PAYROLL`), `Marketing y publicidad` (`MARKETING`), `Comisiones Shopify y pago` (`SHOPIFY_FEES`), `Envíos y empaques` (`SHIPPING`), `Impuestos` (`TAX`), `Contador` (`TAX`), `Intereses y comisiones bancarias` (`DEBT`), `Pago de capital de deuda` (`DEBT`, con `affects_operating_profit: false`), `Retiro del dueño` (`OWNER`), `Reinversión` (`OWNER`), `Otros` (`OTHER`).

La siembra MUST ser idempotente: ejecutarla varias veces no crea duplicados.

Una categoría con `is_system: true` MUST NOT poder borrarse ni cambiar de `name` ni de `type`; sus banderas de reporte sí MUST poder ajustarse.

#### Scenario: Siembra idempotente

- **WHEN** el módulo arranca dos veces consecutivas
- **THEN** el catálogo contiene exactamente una fila por cada categoría de sistema

#### Scenario: Intento de borrar una categoría de sistema

- **WHEN** se envía `DELETE /expense-categories/:id` sobre `Nómina salario`
- **THEN** el sistema responde `409 Conflict` explicando que es una categoría de sistema, y no la borra

#### Scenario: Intento de renombrar una categoría de sistema

- **WHEN** se envía `PATCH /expense-categories/:id` con `{ "name": "Sueldos" }` sobre una categoría de sistema
- **THEN** el sistema responde `409 Conflict` y no la modifica

### Requirement: CRUD de categorías bajo permisos

El sistema SHALL exponer `POST`, `GET`, `GET /:id`, `PATCH` y `DELETE` sobre `/expense-categories`, cada uno protegido por el permiso `expense_category:<action>` correspondiente.

`GET /expense-categories` MUST aceptar el filtro `type` y el filtro `is_system`.

#### Scenario: Petición sin permiso

- **WHEN** un usuario con JWT válido pero sin `expense_category:read` pide `GET /expense-categories`
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Filtrar por tipo

- **WHEN** se pide `GET /expense-categories?type=PAYROLL`
- **THEN** la respuesta contiene sólo categorías de tipo `PAYROLL`

### Requirement: Una categoría en uso no se borra

El sistema MUST rechazar el borrado de una categoría que tenga gastos asociados.

#### Scenario: Categoría con gastos

- **WHEN** se envía `DELETE /expense-categories/:id` de una categoría propia con 3 gastos asociados
- **THEN** el sistema responde `409 Conflict` indicando cuántos gastos la usan, y no la borra

#### Scenario: Categoría sin gastos

- **WHEN** se envía `DELETE /expense-categories/:id` de una categoría propia, no de sistema y sin gastos
- **THEN** el sistema responde `200 OK` y la categoría desaparece del catálogo
