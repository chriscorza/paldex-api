## Why

The MCP surface proved its plumbing with expenses; the first thing an AI agent actually needs to
answer questions about the business is sales. Today nothing in the API can answer "how did each day
sell" — `GET /reports/monthly` returns a single aggregate for a period and `GET /reports/trends`
returns monthly buckets, so a question as ordinary as "which day of last week was weakest" has no
data source at all. This change adds a daily sales series and exposes it as the MCP tool.

It also sets the policy going forward: **new MCP tools are read-only**. `expense_create` stays as
the one existing exception, but nothing else that writes gets added.

## What Changes

- Add a daily sales breakdown: per day within a date range, `net_sales`, `gross_sales`,
  `discounts`, `fees`, `shipping_charged` and `sales_count`, plus a totals block for the whole
  range.
- Expose it as `GET /reports/sales-daily` (`report:read`) — a real REST endpoint, not an
  MCP-only data path, so it stays visible in `/api-docs`, testable like every other report, and
  usable by the frontend for charting.
- Add the MCP tool `sales_daily` wrapping it, taking `start_date` and `end_date`. **The tool takes
  an explicit range, not "current month"** — the agent resolves what "this month" means and sends
  the dates, which keeps date interpretation in the one place that has the user's intent.
- **Days with no sales are returned as explicit zero rows**, never omitted, so a gap in the series
  can't be misread as missing data.
- Establish that MCP tools added from now on are read-only. `expense_create` remains the sole
  write tool; no new one is added. **BREAKING**: none — additive.

## Capabilities

### New Capabilities
- `daily-sales-report`: the day-by-day sales series — its aggregation in the business time zone,
  the zero-day rule, the range cap, and the totals block.

### Modified Capabilities
- `mcp-server`: the tool registry grows from two tools to three, and gains the standing rule that
  further tools are read-only.

## Impact

- **New code**: `src/reports/daily-sales.service.ts`, its DTO and entity, a `GET
  /reports/sales-daily` handler on the existing `ReportsController`, and the `sales_daily` tool in
  `src/mcp/mcp-tools.service.ts`.
- **New helper**: a zone-aware `dateKeyInZone()` in `src/common/timezone.ts` — `weekdayInZone`
  exists but there is nothing that yields a `YYYY-MM-DD` bucket key in the business zone.
- **Permissions**: none new — `report:read`, like every other report. The `ai_agent` role needs
  `report:read` added to actually use the tool.
- **Docs**: the tool ↔ REST table in `src/mcp/CLAUDE.md`, plus a note in `paldex-api/CLAUDE.md`
  alongside the other report sections.
- **No schema change** — it reads existing `Income` rows.
