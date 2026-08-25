## 1. Query DTO

- [x] 1.1 Add `start_date` / `end_date` (`@IsDateString()`, optional) to
      `SalesByEmployeeQueryDto`, and replace the "no ranges on purpose" comment with why ranges are
      now safe (the period no longer claims a month it does not cover — see 2.2)
- [x] 1.2 Add optional `employee_ids: number[]`, documented as: omitted = everyone, one id = that
      person, several = compare them
- [x] 1.3 Make sure the array survives query-string parsing the way the global `ValidationPipe`
      (`transform`, `enableImplicitConversion`) delivers it — a single `employee_ids=3` must arrive
      as `[3]`, not `3`

## 2. Period resolution

- [x] 2.1 Extend `resolvePeriod` to accept `year`+`month` **or** `start_date`+`end_date`: both
      forms together is a `400`, half of either is a `400`, neither keeps the current month in the
      business zone
- [x] 2.2 Populate `period.year` / `period.month` only when the period is exactly one calendar
      month in the business zone (compare against `monthRangeInZone` of the start's month); `null`
      otherwise — never derive a month from `start_date` alone
- [x] 2.3 Make `year` / `month` nullable on `SalesByEmployeePeriodEntity`, documenting when they
      are filled

## 3. Filtering and totals

- [x] 3.1 Query employees without the `active: true` restriction, selecting `active` too, so an
      explicitly requested inactive employee can be reported rather than vanish; keep giving days
      only to active ones
- [x] 3.2 Add `active` to `SalesByEmployeeRowEntity`
- [x] 3.3 Validate `employee_ids`: any id not belonging to this owner is a `400`
- [x] 3.4 Bucket and attribute across **all** employees first, then filter the rows — never narrow
      the income query, which would reassign other people's days
- [x] 3.5 Omit `unassigned` when filtering, unless a `null` entry explicitly asks for it
- [x] 3.6 Compute `totals` from the returned rows and `period_totals` from all buckets; add
      `period_totals` to `SalesByEmployeeReportEntity`, documented as the thing that keeps the
      reconcile checkable under filtering

## 4. Endpoint

- [x] 4.1 Update the `@ApiOperation` description on `GET /reports/sales-by-employee`: ranges, the
      filter, `period_totals`, and that a range spanning a shift reassignment reports the whole
      span under today's owners

## 5. Tests

- [x] 5.1 Period: range honoured; both forms together rejected; half a range rejected; no period =
      current month
- [x] 5.2 Period: `year`/`month` filled for `year`+`month`, filled for a range that is exactly one
      month, `null` for 15-Jan–15-Feb
- [x] 5.3 Filter: one employee; several; unknown id rejected; `unassigned` omitted when filtering
      and present when not
- [x] 5.4 Filter does not reassign: an employee's figures are identical filtered and unfiltered
- [x] 5.5 Totals: `totals` equals `period_totals` unfiltered; differs when filtered while
      `period_totals` stays whole
- [x] 5.6 Inactive: a requested inactive employee comes back `active: false` with zeros, and their
      days still fall to whoever holds them now
- [x] 5.7 Regression: the existing month-based behavior is unchanged (weekday in business zone,
      `unassigned` present, totals reconcile)

## 6. MCP tool

- [x] 6.1 Register `sales_by_employee` in `src/mcp/mcp-tools.service.ts` — `report:read`, required
      `start_date`/`end_date`, optional `employee_ids`, no default period
- [x] 6.2 Update the registry test to expect exactly `expenses_list`, `sales_daily`,
      `sales_by_employee`, `expense_create`, keeping the only-one-write-tool assertion
- [x] 6.3 Test: checks `report:read`; refuses without it; fails without a range; passes
      `employee_ids` through

## 7. Live verification (dev stack)

- [x] 7.1 Seed two employees with non-overlapping `sales_days` plus incomes across both shifts,
      including a late-evening sale that belongs to the earlier local day
- [x] 7.2 Unfiltered range: rows for both employees plus `unassigned`, `totals` equal to
      `period_totals`
- [x] 7.3 Filtered to one employee: only that row, `totals` narrowed, `period_totals` unchanged
- [x] 7.4 Reconcile: `period_totals.net_sales` for a full month equals `GET /reports/monthly`
- [x] 7.5 Same range through the MCP tool returns identical data
- [x] 7.6 Deactivate one employee and confirm the requested row comes back `active: false`
- [x] 7.7 Clean up the seeded data

## 8. Docs

- [x] 8.1 Add `sales_by_employee` to the tool ↔ REST table in `src/mcp/CLAUDE.md`
- [x] 8.2 Update "Sales attributed to employees" in `paldex-api/CLAUDE.md`: it currently says the
      report is monthly. Cover ranges, the filter, `period_totals` vs `totals`, the inactive rule,
      and sharpen the no-shift-history warning now that a range makes it easier to hit
