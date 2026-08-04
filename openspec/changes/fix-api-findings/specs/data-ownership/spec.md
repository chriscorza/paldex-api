## ADDED Requirements

### Requirement: getMissing filtra por owner

El sistema SHALL aplicar filtro de owner en `product-costs.getMissing()`, usando la cadena de relaciones `shopify_order → shopify_connection → user_id`. Los usuarios con scope `OWN` MUST ver solo line items de Shopify de órdenes vinculadas a sus propias conexiones.

#### Scenario: Usuario OWN solo ve sus line items sin costo

- **WHEN** el usuario A (scope `OWN`) llama a `getMissing` y existen line items sin `unit_cost` de conexiones de A y de B
- **THEN** el resultado contiene solo los line items de la conexión de A

#### Scenario: Admin ANY ve todos los line items

- **WHEN** un admin (scope `ANY`) llama a `getMissing`
- **THEN** el resultado contiene line items sin costo de todas las conexiones

### Requirement: recalculateCosts filtra por owner

El sistema SHALL aplicar filtro de owner en `line-item-projection.recalculateCosts()`. El controlador MUST recibir `@CurrentUser()` y `@Req()` para construir el contexto de ownership. Las órdenes de Shopify procesadas MUST pertenecer a conexiones del usuario autenticado.

#### Scenario: Usuario OWN solo recalcula sus órdenes

- **WHEN** el usuario A (scope `OWN`) llama a `recalculateCosts` y existen órdenes de Shopify de conexiones de A y de B en el rango de fechas
- **THEN** solo las órdenes de la conexión de A se procesan

### Requirement: getCashReport filtra payroll y taxes por owner

El sistema SHALL aplicar filtro de owner en todas las queries internas de `getCashReport`:

- Los payroll payments agregados por cuenta (`PAID`) SHALL filtrarse via `employee: { ...ownerFilter }`
- Los tax payments agregados por cuenta (`PAID`) SHALL filtrarse via `{ ...ownerFilter }`
- El agregado global de payroll pendiente SHALL filtrarse via `employee: { ...ownerFilter }`
- El agregado global de taxes pendientes SHALL filtrarse via `{ ...ownerFilter }`

#### Scenario: Cash report de usuario OWN solo incluye su nómina

- **WHEN** el usuario A (scope `OWN`) llama a `getCashReport` y existen payroll payments de empleados de A y de B
- **THEN** el reporte solo suma los payroll payments vinculados a empleados de A

#### Scenario: Cash report de usuario OWN solo incluye sus tax payments

- **WHEN** el usuario A (scope `OWN`) llama a `getCashReport` y existen tax payments de A y de B
- **THEN** el reporte solo suma los tax payments de A
