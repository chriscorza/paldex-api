# paldex-api Development Notes

## Authorization

This project uses **deny-by-default** authorization. Every new handler needs:

1. `@RequirePermissions('resource:action')` decorator on the handler or controller class
2. The corresponding entry in `src/permissions/permission-catalog.ts`

Without both, the handler will return `403 Forbidden` with no hint why.

### Permission format: `resource:action`

Resources: `income`, `expense`, `account`, `tax`, `user`, `role`, `permission`, `expense_category`, `cogs`, `employee`, `payroll`, `tax_payment`, `report`, `product_cost`, `product_category_override`, `recurring_expense`, `payable`, `receivable`, `monthly_close`
Actions: `read`, `create`, `update`, `delete`

Special cases:
- `user:assign_role` — used for `PATCH /user/:id/role`
- `/user/me` endpoints only require authentication, no specific permission

### Adding a new permission

1. Add entry to `PERMISSION_CATALOG` array in `src/permissions/permission-catalog.ts`
2. Restart the API — the sync runs on `onModuleInit` and creates the DB row if missing
3. Apply `@RequirePermissions(...)` on the relevant handler

### Roles

- `admin` and `user` are system roles (`is_system: true`) — cannot be deleted or renamed
- Admin role must always retain `role:update` and `user:assign_role` (anti-lockout)
- Permissions are cached per role; cache invalidates on `PUT /roles/:id/permissions`, `DELETE /roles/:id`, and `PATCH /user/:id/role`
- Cache is per-process — doesn't propagate across instances

### Admin bootstrap

Set `ADMIN_EMAIL` in `.env.prod` to auto-promote a user at startup.
Or run: `npx ts-node -r tsconfig-paths/register scripts/bootstrap-admin.ts <email>`

### Migrations

Generated via Prisma inside the Docker container:
`docker exec paldex-api-1 npx prisma migrate dev --create-only`

## API contract for the frontend

The full API contract is generated from the real controllers/DTOs via `@nestjs/swagger` —
it is never hand-written, so it cannot drift from what the API actually does.

- Browse it live at **`/api-docs`** while the API is running (`npm run start:dev` or `docker-compose up`).
- Raw OpenAPI JSON at **`/api-docs/json`** — feed this into `openapi-typescript` or a similar
  generator from `paldex-app` to get a typed client instead of hand-writing fetch calls.
- The CLI plugin (`@nestjs/swagger` in `nest-cli.json`) infers request/response shapes from
  DTOs and entity classes automatically. New endpoints get documented for free as long as their
  body/query use a real class (not an inline `{ foo: string }` type or a bare `Prisma.*Input`) —
  Swagger cannot introspect those.

### Shopify OAuth flow (not a normal request/response — read this before wiring the frontend)

1. Frontend calls `POST /shopify/connections/install` (normal `fetch`, JWT in `Authorization`) → gets `{ authorize_url }`.
2. Frontend does a **full page navigation** to `authorize_url` (`window.location.href = ...`, not `fetch`). The user approves access inside Shopify.
3. Shopify redirects the browser straight to `GET /shopify/oauth/callback` on **this API** — the frontend never calls this endpoint itself.
4. This API redirects the browser again, this time to `SHOPIFY_FRONTEND_URL` (env var, defaults to `http://localhost:3002` in dev), with:
   - Success: `?shopify=success&shop=<domain>`
   - Error: `?shopify=error&reason=<code>` — `reason` is one of `invalid_state`, `missing_credentials`, `token_exchange_failed`, `unsupported_currency`, `unknown`
5. The frontend needs a route that reads these query params on load and shows success/error accordingly.

Only stores billing in **MXN** are accepted — `unsupported_currency` is the expected error for anything else.

### Shopify env vars

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES` (`read_orders,read_inventory`),
`SHOPIFY_CALLBACK_URL` (must match the Partner Dashboard redirect URI, points at this API),
`SHOPIFY_FRONTEND_URL` (where the OAuth callback sends the browser back to),
`SHOPIFY_TOKEN_ENCRYPTION_KEY` (32 bytes, hex-encoded — `openssl rand -hex 32`).

## Money handling

All monetary columns in the schema use `Decimal(14,2)`. The API always returns **numbers** (not strings) in JSON responses by converting `Decimal → number` in entity projections via `src/common/money.ts`.

**Rules:**
- Use `toMoneyNumber()` in entity constructors for every monetary field
- Use `percentage(numerator, denominator)` for ratios — returns `null` when denominator is zero
- Never do floating-point arithmetic on money — use Prisma `Decimal` or SQL aggregates

## No-duplication rules

Three rules prevent double-counting in financial reports:

1. **Payroll**: `PayrollPayment` is the single source of truth for payroll. Paying payroll **must not** create `Expense` rows. The report projects `PayrollPayment` directly.
2. **Taxes**: `TaxPayment` is the single source of truth for tax payments (IVA/ISR). Paying taxes **must not** create `Expense` rows.
3. **COGS**: The COGS line in reports comes **exclusively** from `CostOfGoodsSold` linked to `Income`. An `Expense` of category type `COGS` represents inventory purchases, shown in a separate `inventory_purchases` line — it does not contribute to COGS.

## ISR estimate

Set `ISR_ESTIMATE_PERCENTAGE` env var to a number (e.g., `30`) to enable ISR estimation.
Without it, `GET /tax-payments/estimate` returns `isr_estimated: null`.
The estimate is overridable per-request via `?isr_percentage=X`.
