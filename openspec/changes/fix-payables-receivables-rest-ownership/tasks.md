## 1. Payables / receivables

- [ ] 1.1 `removePayment(ctx, id)`: resolver el pago con `where: { id, payable: buildOwnerFilter(ctx) }`; 404 si ajeno; propiedad antes que estado.
- [ ] 1.2 `removeCollection(ctx, id)`: igual con `receivable`.
- [ ] 1.3 Controllers pasan `ctx` (`permissionScope || 'OWN'`).
- [ ] 1.4 Tests en memoria cross-owner: el pago ajeno no se borra y `paid_amount` de la cuenta ajena no cambia.

## 2. Product-category-overrides

- [ ] 2.1 Decidir (Open Question) si se mueve a servicio con `OwnershipContext` y scope `ANY`.

## 3. Verificación

- [ ] 3.1 `npm test`, lint, `openspec validate fix-payables-receivables-rest-ownership --strict`.
