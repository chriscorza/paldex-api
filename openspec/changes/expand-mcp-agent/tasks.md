## 1. Infraestructura

- [ ] 1.1 Modelo `McpAction` y migración aditiva (`mcp_actions` con índice único `(owner_user_id, tool, client_ref)` e índice `(owner_user_id, entity, entity_id)`); `mcp_action:read` en `PERMISSION_CATALOG`.
- [ ] 1.2 `src/mcp/toolkit.ts` con `defineTool`: autorización, validación con el DTO (`plainToInstance` + `validate` con las opciones del `ValidationPipe` global), idempotencia, advertencias, registro en `mcp_actions` (reintento único + `ACTION_NOT_LOGGED`), respuesta `{ entity, warnings, action_id }` y anotaciones MCP por `kind`.
- [ ] 1.3 Tokens de confirmación de borrado (HMAC sobre key, tool, entity_id y vencimiento a 10 min) y la regla "sólo lo que creó una llave del mismo dueño".
- [ ] 1.4 Advertencia `CLOSED_MONTH` con el mes en la zona del negocio (`dateKeyInZone`).
- [ ] 1.5 Detección `POSSIBLE_DUPLICATE` para gastos e ingresos (monto, ±3 días, cuenta/proveedor/concepto normalizado).
- [ ] 1.6 Corregir `CloseGuard.ensureOpen` para que calcule el mes en la zona del negocio, con prueba del borde 31 de octubre 20:00 CDMX.
- [ ] 1.7 Reorganizar `src/mcp/`: `tools/<dominio>.tools.ts`; migrar las 8 tools actuales al toolkit sin cambiar nombres ni argumentos; las de escritura pasan a responder con el sobre uniforme.
- [ ] 1.8 Pruebas del toolkit: validación igual a REST, idempotencia (secuencial y concurrente), sobre de respuesta, advertencias, borrado en dos pasos (sin token, token válido, vencido, de otro registro), negativa a borrar lo no creado por el agente.

## 2. Contexto y lecturas

- [ ] 2.1 `context_get` (con partes `null` + motivo cuando falta permiso).
- [ ] 2.2 Listas y detalles: `expense_get`, `incomes_list`, `income_get`, `payables_list`, `payable_get`, `receivables_list`, `receivable_get`, `recurring_expenses_list`, `tax_payments_list`, `tax_payment_estimate`, `employees_list`, `fixed_assets_list`, `product_costs_list`, `product_costs_missing`, `cogs_list`, `accounts_list`, `expense_categories_list`, `taxes_list`.
- [ ] 2.3 Reportes: `monthly_report`, `expenses_breakdown`, `cash_report`, `inventory_valuation`, `sales_without_cost`, `monthly_close_status` (sólo lectura del preflight y del estado).

## 3. Captura del día a día

- [ ] 3.1 Gastos: `expense_update`, `expense_pay`, `expense_delete`.
- [ ] 3.2 Ingresos: `income_create`, `income_update`, `income_delete`, con la negativa para ingresos de Shopify.
- [ ] 3.3 Cuentas por pagar: `payable_create`, `payable_update`, `payable_add_payment`, `payable_delete`, `payable_payment_delete`.
- [ ] 3.4 Cuentas por cobrar: `receivable_create`, `receivable_update`, `receivable_add_collection`, `receivable_delete`, `receivable_collection_delete`.
- [ ] 3.5 Gastos recurrentes: `recurring_expense_create`, `recurring_expense_update`, `recurring_expense_delete`.
- [ ] 3.6 Pagos de impuestos: `tax_payment_create`, `tax_payment_update`, `tax_payment_pay`, `tax_payment_delete` (sale de la lista negra).

## 4. Nómina, empleados, activos y costos

- [ ] 4.1 Nómina: `payroll_generate`, `payroll_update`, `payroll_delete`; `payroll_create` y `payroll_pay` migrados al toolkit.
- [ ] 4.2 Empleados: `employee_create`, `employee_update`, `employee_delete` (desactiva, como REST).
- [ ] 4.3 Activos fijos: `fixed_asset_create`, `fixed_asset_update`, `fixed_asset_dispose`, `fixed_asset_delete`.
- [ ] 4.4 Costos de producto: `product_cost_create`, `product_cost_update`, `product_cost_delete`.
- [ ] 4.5 Costo de lo vendido: `cogs_create`, `cogs_update`, `cogs_delete`.

## 5. Configuración

- [ ] 5.1 Cuentas: `account_create`, `account_update`, `account_delete` (se niega con movimientos, como REST).
- [ ] 5.2 Categorías: `expense_category_create`, `expense_category_update`, `expense_category_delete` (las de sistema no se editan ni borran, como REST).
- [ ] 5.3 Catálogo de impuestos: `tax_create`, `tax_update`, `tax_delete`.

## 6. Carga masiva

- [ ] 6.1 `expenses_create_bulk`, `incomes_create_bulk` y `product_costs_bulk` (≤ 100, resultado por elemento, resumen).
- [ ] 6.2 Pruebas: lote con un renglón inválido, reenvío del mismo lote (sólo entra lo corregido), duplicados por `client_ref` dentro del mismo lote.

## 7. Registro de acciones por API

- [ ] 7.1 `GET /mcp-actions` (filtros de fecha, entidad y tool; `mcp_action:read`; sin `@AllowApiKey`).
- [ ] 7.2 Pruebas de filtrado por dueño y de que una llave no puede leerlo.

## 8. Permisos, documentación y verificación

- [ ] 8.1 `scripts/grant-ai-agent-permissions.ts`: lee del registro el permiso de cada tool y se los otorga al rol `ai_agent` con alcance `OWN`, mostrando antes lo que va a cambiar.
- [ ] 8.2 Prueba del registro: enumera cada tool y cada tool de escritura, comprueba anotaciones según `kind` y mantiene la lista negra.
- [ ] 8.3 Reescribir `src/mcp/CLAUDE.md`: nueva política, tabla tool ↔ REST ↔ permiso, sobre de respuesta, idempotencia, borrado en dos pasos, advertencias.
- [ ] 8.4 Entrada en `CHANGELOG.md` (MINOR) y versión.
- [ ] 8.5 `npm test`, `npm run lint`, `openspec validate expand-mcp-agent --strict`.
- [ ] 8.6 En producción: correr el script de permisos, `tools/list`, `context_get`, y una sesión real: registrar tres gastos con `client_ref` (reenviando uno), corregir uno, borrar uno en dos pasos, y revisar `GET /mcp-actions`.
