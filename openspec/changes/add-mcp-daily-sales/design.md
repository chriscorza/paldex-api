## Context

Two constraints from this codebase shape everything here.

**The time zone.** Every report range is built in the business zone (`REPORTS_TIMEZONE`, default
`America/Mexico_City`), never UTC. For a daily breakdown this stops being a rounding detail and
becomes the whole correctness question: a 19:00 sale on the 5th in CDMX is already the 6th in UTC,
so grouping by the raw timestamp files roughly the entire evening — the busiest part of the day —
under tomorrow.

**Grouping cannot happen in SQL.** `sales-by-employee` already hit this and documented it:
`CONVERT_TZ` requires MySQL's timezone tables, which the `mysql:8.4` image does not ship. Without
them it returns `NULL`, and the report silently reads zero — a wrong answer that looks like a real
one. Node's `Intl` depends on nothing the server was provisioned with.

There is no existing endpoint to extend: `/reports/monthly` is one aggregate over a period and
`/reports/trends` is monthly buckets. Daily is genuinely new aggregation.

## Goals / Non-Goals

**Goals:**
- A per-day sales series over an explicit date range, correct in the business time zone.
- Reconcilable: summing the days over a month must equal that month's `net_sales` from
  `GET /reports/monthly`.
- Reachable both as REST and as an MCP tool, from one implementation.

**Non-Goals:**
- Profit, COGS or margin per day. This is a *sales* series; cost data has its own coverage caveats
  (`cost_data_coverage`) and mixing them in would smuggle an unguarded profit number into a tool
  that says "sales".
- A "current month" default. The tool takes explicit dates — see decision #2.
- Per-employee or per-channel splits. Those exist elsewhere and would multiply the row count.
- Any new write capability. Read-only from here on.

## Decisions

### 1. Group in Node with `Intl`, never in SQL
Rows are fetched with a plain `date: { gte, lte }` filter and bucketed in Node by a
`dateKeyInZone(date, timeZone)` helper that formats the instant as `YYYY-MM-DD` in the business
zone via `Intl.DateTimeFormat` — the same approach and the same reasoning as `weekdayInZone`. A
comment must record *why*, because `GROUP BY DATE(date)` is the obvious refactor and it is silently
wrong in two independent ways (server zone, and `CONVERT_TZ` returning NULL).

`weekdayInZone` already exists but yields a weekday number, not a date key, so a new helper is
needed rather than reusing it.

### 2. Explicit `start_date` + `end_date`, no "current month" shortcut
The tool requires both dates. It does not accept `year`+`month` and has no default period.

Reasoning: the agent is the only party that knows what the user meant by "this month" or "last
week", and it already has to resolve relative dates for every other question it answers. Putting a
second, server-side notion of "current" next to it creates two clocks that disagree — the server's
business zone versus whatever the agent assumed — and the disagreement would surface as a silently
wrong period rather than an error. One place decides, and it is the one holding the intent.

*Consequence to accept*: the tool is slightly less convenient to call by hand. Worth it.

### 3. Days with no sales are zero rows, not gaps
Every date in the range appears, `sales_count: 0` and zeroed money when nothing sold. Omitting them
would make an agent unable to distinguish "sold nothing that day" from "no data for that day", and
those lead to opposite conclusions about the business. This mirrors the `unassigned` row in
`sales-by-employee`, present even at zero for the same reason: the series must be complete to be
checkable.

### 4. The range is capped at 366 days
An uncapped range returns a row per day straight into an LLM context window. 366 covers any
"compare against last year" question while bounding the response. Over the cap is a
`BadRequestException`, not a silent truncation — a truncated series that looks complete is the
failure mode worth avoiding, since every total computed from it would be quietly wrong.

### 5. A REST endpoint, not an MCP-only path
`GET /reports/sales-daily` is added and the tool calls the same service, per the established rule
that tools call services directly and each tool pairs with a REST endpoint. An MCP-only data path
would be invisible in `/api-docs`, unreachable by the frontend that may well want this chart, and
testable only through the MCP protocol.

### 6. Money stays in `Decimal` until the projection
Accumulation uses Prisma `Decimal`, converted with `toMoneyNumber()` only when building the
response, per the project's money rules. Summing floats across 366 buckets is exactly where cents
drift, and this report's whole value is that its days add up to the month.

### 7. `income_type` is deliberately not filtered
Matching `sales-by-employee` and the monthly report. Filtering here would break the reconcile
against `GET /reports/monthly`, which is the property that makes this report trustworthy.

## Risks / Trade-offs

- **[Risk]** Someone later "optimizes" the Node grouping into SQL and silently zeroes the report. →
  The comment explains both failure modes, and a spec scenario asserts an evening sale near
  midnight lands on the local day, which a SQL rewrite would fail.
- **[Risk]** DST transitions make a local day 23 or 25 hours long. → `Intl` formatting handles this
  because the bucket key is derived from the formatted local date, not from arithmetic on hours;
  no manual offset is ever computed.
- **[Trade-off]** Fetching rows and grouping in Node costs more memory than a SQL aggregate. Bounded
  by the 366-day cap and by only selecting the handful of columns needed; correctness wins over an
  optimization that cannot be made correct on this MySQL image.
- **[Risk]** Adding `report:read` to the `ai_agent` role widens the agent beyond expenses — it
  unlocks every existing report *endpoint* for that role. → It does not widen MCP: the denylist is
  structural, so only tools that exist are reachable, and the only report tool is this one. Worth
  stating explicitly because the role grant looks broader than the actual exposure.

## Migration Plan

1. Ship the helper, service, endpoint and tool together — additive, no migration, no schema change.
2. Grant `report:read` to the `ai_agent` role so the tool is usable.
3. Rollback is removing the tool registration; the REST endpoint is independently harmless.

## Open Questions

- Should the totals block include a per-day average, or is that better left to the agent (which can
  divide, and knows whether to exclude zero days from the denominator)? Leaning toward leaving it
  out — an average over a range containing closed days is a number that invites misreading.
