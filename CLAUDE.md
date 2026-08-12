# paldex-api Development Notes

## Authorization

This project uses **deny-by-default** authorization. Every new handler needs:

1. `@RequirePermissions('resource:action')` decorator on the handler or controller class
2. The corresponding entry in `src/permissions/permission-catalog.ts`

Without both, the handler will return `403 Forbidden` with no hint why.

### Permission format: `resource:action`

See `src/permissions/permission-catalog.ts` for the current list of resources/actions (many resources also have an `OWN`-scoped variant).

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

Shopify integration (OAuth flow, env vars) is documented in `src/shopify/CLAUDE.md`.

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

## Report date ranges and time zone

Every report range is built in the **business time zone**, never UTC — `src/common/timezone.ts`.
Set `REPORTS_TIMEZONE` to an IANA name to change it; it defaults to `America/Mexico_City`.

- `start_date` means 00:00:00.000 of that day in that zone, `end_date` means 23:59:59.999 — the
  final day is **included**. A string that already carries a time is taken literally instead.
- `year`+`month` covers the whole month in the same zone.

This matters when reconciling against Shopify: its sales reports use the shop's zone, so filtering
in UTC shifts a Mexican shop's month by 6 hours and drops the last (busiest) evening of it.

## ISR estimate

Set `ISR_ESTIMATE_PERCENTAGE` env var to a number (e.g., `30`) to enable ISR estimation.
Without it, `GET /tax-payments/estimate` returns `isr_estimated: null`.
The estimate is overridable per-request via `?isr_percentage=X`.

## Common commands

The app reads its env via `ConfigModule.forRoot({ envFilePath: '.env.prod' })` (see `src/app.module.ts`) — note this is `.env.prod`, not `.env`, even for local/dev runs. Required vars include `DATABASE_URL` (MySQL) and `JWT_SECRET`.

## Architecture

Auth model:
- `AuthGuard` (`src/auth/auth.guard.ts`) is registered globally via `APP_GUARD` in `app.module.ts`, so **every route requires a valid JWT by default**.
- Use the `@Public()` decorator (`src/auth/auth.decorator.ts`, backed by `IS_PUBLIC_KEY` in `src/globalConstants.ts`) on a controller or handler to opt out of auth.
- `AuthService.signIn` compares the submitted password against `user.password` directly (no hashing) — this is scaffolding, not production-ready auth.
- JWT payload is `{ id, email }`, verified/signed with `JWT_SECRET`, 7-day expiry.

Other conventions:
- `PrismaService` (`src/prisma.service.ts`) is a global-ish injectable wrapping `PrismaClient`; services take `PrismaService` in their constructor and call `this.prisma.<model>.findMany/create/...` directly rather than going through a repository layer.
- Shared query-filter shape lives in `src/types.ts` (`FilteredInput`: date range, search, sort, pagination) — controllers accept this via `@Query()` and translate it into a Prisma `WhereInput`.
