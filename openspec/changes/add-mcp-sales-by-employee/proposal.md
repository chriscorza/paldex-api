## Why

`GET /reports/sales-by-employee` already answers "how did each person sell", but only for a whole
calendar month and only for everyone at once. The questions an agent actually gets are narrower —
"how did Luis do last week", "compare Luis and Ana this fortnight" — and neither is expressible
today: there is no date range, and no way to ask about one person or a few.

## What Changes

- Extend `GET /reports/sales-by-employee` to accept `start_date` + `end_date` as an alternative to
  `year` + `month`, following the same either/or pattern `GET /reports/monthly` already uses
  (`resolveDateRange`: both forms optional, supplying both is a `400`).
- Add an optional `employee_ids` filter. Omitted returns everyone, as today; one id answers "how
  did this person do"; several answer "compare these people". One parameter covers all three cases.
- **When filtering, `totals` sums only the selected rows, and a new `period_totals` block always
  reports the whole period** — every employee plus `unassigned`. Without it, "Luis: 40,000" gives
  no way to tell whether that is most of the period's sales or a sliver of it, and the reconcile
  against `GET /reports/monthly` would stop being checkable the moment anyone filtered.
- **An explicitly requested employee who is inactive is flagged, not silently zeroed.** Inactive
  employees hold no `sales_days`, so their row would come back at zero as if they had sold
  nothing, when in truth their days now belong to somebody else.
- Add the MCP tool `sales_by_employee` (`report:read`, read-only) wrapping it, with the same
  explicit-range rule as `sales_daily`: no implicit "this month".
- The tool mirrors the endpoint fully, including `cogs`, `gross_profit` and `cost_data_coverage` —
  the profit figure already publishes the guard that says how far to trust it.

## Capabilities

### New Capabilities
(none — this extends an existing report and adds a tool for it)

### Modified Capabilities
- `sales-by-employee-report`: gains date-range periods, the employee filter, the `period_totals`
  block, and the inactive-employee rule.
- `mcp-server`: the registry gains a fourth tool, `sales_by_employee`.

## Impact

- **Modified code**: `src/reports/sales-by-employee.service.ts` (period resolution, filtering,
  period totals), its DTO and entity, and `src/mcp/mcp-tools.service.ts`.
- **Backward compatible**: `year`/`month` keep working unchanged and `employee_ids` is optional, so
  existing callers — including the frontend — see no behavior change. `period.year` / `period.month`
  become nullable, populated only when the range is exactly one calendar month.
- **Permissions**: none new — `report:read`, as today.
- **No schema change** — it reads existing `Income`, `Employee` and `CostOfGoodsSold` rows.
- **Docs**: the tool ↔ REST table in `src/mcp/CLAUDE.md`, and the "Sales attributed to employees"
  section of `paldex-api/CLAUDE.md`, which currently states the report is monthly.
