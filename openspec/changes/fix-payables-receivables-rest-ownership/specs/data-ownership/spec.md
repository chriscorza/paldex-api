## ADDED Requirements

### Requirement: Pagos de cuentas por pagar y cobros de cuentas por cobrar heredan la propiedad de su cuenta

Borrar un pago de una cuenta por pagar o un cobro de una cuenta por cobrar SHALL resolverse a través del propietario de la cuenta padre. Con scope `OWN`, un registro de otro propietario SHALL responder `404 Not Found`, igual que uno inexistente, sin borrar nada ni recalcular la cuenta ajena.

#### Scenario: Borrar el pago de una cuenta por pagar ajena

- **WHEN** un usuario A con scope `OWN` ejecuta `DELETE /payables/payments/:id` con el id de un pago de una cuenta por pagar de B
- **THEN** el sistema responde `404 Not Found`
- **AND** el pago y el `paid_amount` de la cuenta de B no cambian
