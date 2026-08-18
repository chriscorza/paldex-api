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

## Sales attributed to employees

`Employee.sales_days` holds the weekdays whose sales belong to that employee (`1` = Monday …
`7` = Sunday, ISO-8601; `null`/`[]` means none). `GET /reports/sales-by-employee` reports
`net_sales`, `gross_sales`, `sales_count`, `cogs` and `gross_profit` per employee for a month —
current month by default, `year`+`month` for any earlier one.

- **The weekday is computed in the business time zone** via `weekdayInZone()`, never `getDay()`:
  in CDMX a 19:00 Friday sale is Saturday in UTC and would be credited to the weekend shift.
- **Grouping happens in Node, not SQL.** `CONVERT_TZ` needs MySQL's timezone tables loaded, which
  the `mysql:8.4` image does not ship — without them it returns `NULL` and the report silently
  reads zero.
- **A day belongs to at most one *active* employee.** MySQL can't enforce that over a JSON column,
  so `EmployeesService` checks it inside the writing transaction — on create, on `sales_days`
  edits, **and on reactivation**, since reactivating an inactive employee also claims their days.
  Inactive employees don't hold days.
- **The `unassigned` row is always present**, even at zero: the sum of all rows must equal
  `net_sales` from `GET /reports/monthly`, and a day with no owner would otherwise drop sales out
  of the total with nothing to show for it. The report deliberately does not filter by
  `income_type`, for the same reason.
- **`gross_profit` is product profit**, `net_sales - cogs`, straight from `CostOfGoodsSold` linked
  to each `Income` — never from a COGS-category `Expense`. It does not subtract that employee's
  salary or the shop's overhead, so it is not what the business earns per person.
- **`cost_data_coverage` guards that number.** A sale with no captured cost subtracts nothing, so
  its profit comes out whole. Such sales are still counted (dropping them would break the reconcile
  against sales), so the row publishes how many had cost: below 100% the profit is a ceiling.
- **There is no shift history**: a past month is recomputed with today's assignment. If two
  employees swap days, earlier reports change with them.

## Inventory cost by product

`GET /reports/inventory-cost` crosses the cost catalog with what was sold: every `ProductCost`
entry — sold or not — plus any product sold that has no entry, with `unit_cost`, `units_sold` and
`total_cost`, sorted by `total_cost` descending. No params means the current month;
`year`+`month` or `start_date`+`end_date` for any other period.

- **It is not a stock valuation.** Nothing in the schema stores units on hand (the Shopify sync
  pulls `inventoryItem.unitCost`, never inventory levels), so `total_cost` values what was *sold*,
  not what is left. A costly product with no sales shows zero, not the value of its shelf.
- **It is not the P&L's COGS.** That comes from `CostOfGoodsSold` and is dated by collection;
  this values at today's catalog cost and dates by order. `cogs_recorded` — the frozen cost that
  actually hit results — is published per row so the gap is visible instead of surprising.
- **Cost precedence is `ProductCost` by variant, then by SKU**, the same order `resolveLineItemCost`
  uses to cost a sale. Diverging would make the report charge a cost the books never did. A product
  the catalog holds by variant and a line item carrying only its SKU are one row, not two.
- **`effective_from <= end_date`** — a future-dated price increase someone already captured does
  not move the current period; among the effective ones the most recent wins.
- **A product sold with no catalog entry still gets a row**, valued at the cost Shopify froze on the
  sale (`cost_source: 'FROZEN'`, averaged per unit across orders), or with `unit_cost: null` when
  there is none. `cost_coverage` reports what share of units got valued: below 100 `total_cost` is
  a floor.
- **`ProductCost` has no product name** — only variant and SKU. Titles are read back from the line
  items, from any date, so a product that did not sell this period still shows a name.
- **Totals cover the whole catalog, never the returned page.**

## Scheduled jobs

`src/jobs/scheduled-jobs.service.ts` runs three crons in-process via `@nestjs/schedule`
(registered in `app.module.ts` with `ScheduleModule.forRoot()`):

| Job | Cron | Zone |
|---|---|---|
| Payroll generation | `0 6 * * *` | business (`reportsTimeZone()`) |
| Recurring-expense generation | `5 6 * * *` | business |
| Shopify reconciliation | `20 * * * *` | UTC (hourly, zone is irrelevant) |

Conventions to keep if you add another one:

- **Run per owner, not globally.** `RecurringExpensesService.generate` writes `user_id: ctx.userId`
  on every row it creates, so a single `scope: 'ANY'` context would attribute other people's
  expenses to whoever the job pretends to be. The jobs `distinct: ['user_id']` over the owning
  model and call the service once per owner with `scope: 'OWN'`.
- **The window overlaps on purpose** — 7 days back, 45 days forward. Both generators skip what
  already exists (unique-index clash → `P2002`), so re-running a range is free, and the lookback
  is what lets a day of downtime heal itself instead of leaving a payroll period missing forever.
- **Never pass `already_paid`.** That flag is only for loading history by hand.
- The crons must not run on more than one replica: `ScheduleModule` fires in every process.

`SCHEDULED_JOBS_ENABLED=false` turns all three off. It is read at call time, not at module
definition — `ConfigModule` loads `.env.prod` into `process.env` after decorators are evaluated,
so reading it earlier would miss the production value. Absent variable means enabled: forgetting
it on a deploy and silently not generating payroll is the worse failure.

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
