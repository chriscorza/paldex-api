## 1. Time zone helper

- [x] 1.1 Add `dateKeyInZone(instant, timeZone)` to `src/common/timezone.ts` returning `YYYY-MM-DD`
      in the business zone via `Intl.DateTimeFormat`, following the shape of `weekdayInZone`
- [x] 1.2 Comment it with why a SQL date function cannot be used here (server zone is UTC in the
      container; `CONVERT_TZ` returns NULL without MySQL's timezone tables, which the `mysql:8.4`
      image does not ship — the report would silently read zero)
- [x] 1.3 Unit test it: a 19:00 CDMX instant on the 5th keys to `2026-08-05` and not `2026-08-06`,
      plus a DST-transition day

## 2. Daily sales service

- [x] 2.1 Add `src/reports/dto/daily-sales-query.dto.ts` requiring `start_date` and `end_date`
      (both `@IsDateString()`, neither optional)
- [x] 2.2 Add `src/reports/entities/daily-sales.entity.ts`: the per-day row and the totals block,
      converting `Decimal → number` with `toMoneyNumber()`
- [x] 2.3 Add `src/reports/daily-sales.service.ts`: query `Income` with
      `{ ...buildOwnerFilter(ctx), date: { gte, lte } }`, selecting only the fields needed;
      deliberately do **not** filter by `income_type` (comment why: it would break the reconcile
      against `GET /reports/monthly`)
- [x] 2.4 Bucket rows in Node by `dateKeyInZone`, accumulating in Prisma `Decimal`, never floats
- [x] 2.5 Seed every date in the range so days with no sales come back as explicit zero rows
- [x] 2.6 Validate the range: reject inverted ranges and ranges over 366 days with
      `BadRequestException` — never truncate
- [x] 2.7 Compute the totals block from the returned rows

## 3. REST endpoint

- [x] 3.1 Add `GET /reports/sales-daily` to `ReportsController` with `report:read`, building
      `OwnershipContext` the same way the sibling handlers do
- [x] 3.2 Register `DailySalesService` in `reports.module.ts`

## 4. Tests

- [x] 4.1 Service spec: one row per day; zero rows for days with no sales; ascending order
- [x] 4.2 Service spec: an evening sale near midnight lands on its local day (the test that fails
      if someone rewrites the grouping in SQL)
- [x] 4.3 Service spec: totals equal the sum of the rows
- [x] 4.4 Service spec: inverted range and over-366-day range both rejected
- [x] 4.5 Service spec: ownership scope respected (`OWN` sees only its own income)

## 5. MCP tool

- [x] 5.1 Register `sales_daily` in `src/mcp/mcp-tools.service.ts` — `report:read`, required
      `start_date`/`end_date`, no default period, delegating to `DailySalesService`
- [x] 5.2 Import `ReportsModule` (or expose `DailySalesService`) into `McpModule`
- [x] 5.3 Update the registry test in `mcp-tools.service.spec.ts` to expect exactly
      `expenses_list`, `sales_daily`, `expense_create`, and add an assertion that `expense_create`
      is the only write tool
- [x] 5.4 Test: `sales_daily` checks `report:read` and returns a permission error without it
- [x] 5.5 Test: calling it without a range fails rather than defaulting to a period

## 6. Role grant

- [x] 6.1 Add `report:read` to the `ai_agent` role (`PUT /roles/7/permissions`, keeping the
      existing expense permissions) so the tool is usable
- [x] 6.2 Confirm this does not widen MCP itself — the denylist is structural, so only the tools
      that exist are reachable

## 7. Live verification (dev stack)

- [x] 7.1 Seed a few incomes across several days, including one late-evening sale near midnight
      and at least one day with none
- [x] 7.2 `GET /reports/sales-daily` returns the full series with the zero day present and the
      evening sale on its local day
- [x] 7.3 Same range through the `sales_daily` MCP tool returns identical data
- [x] 7.4 Reconcile: totals for a full month equal `net_sales` from `GET /reports/monthly`
- [x] 7.5 Negative: a role without `report:read` gets a permission error from the tool
- [x] 7.6 Clean up the seeded data

## 8. Docs

- [x] 8.1 Add `sales_daily` to the tool ↔ REST table in `src/mcp/CLAUDE.md`, and record that tools
      are read-only from now on with `expense_create` as the sole legacy exception
- [x] 8.2 Add a "Daily sales" section to `paldex-api/CLAUDE.md` next to the other report notes:
      why grouping happens in Node, why zero days are present, the 366-day cap, and that it
      reconciles with the monthly report
