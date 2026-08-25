## Context

This report infers who sold from *when* the sale happened: `Income` records no salesperson, and it
does not need to, because shifts do not overlap — `Employee.sales_days` assigns weekdays, and the
weekday identifies the person. Three properties of the existing implementation constrain any change
to it:

- **The weekday is computed in the business zone** (`weekdayInZone`), because a 19:00 Friday sale in
  CDMX is Saturday in UTC and would be credited to the weekend shift.
- **`unassigned` is always present, even at zero**, and the totals must equal `net_sales` from
  `GET /reports/monthly`. That reconcile is what makes the report checkable; a day with no owner
  would otherwise drop sales out of the total with nothing to show for it.
- **Only *active* employees hold days.** Reactivating someone re-claims their days, and MySQL cannot
  enforce one-owner-per-day over a JSON column, so `EmployeesService` checks it in the writing
  transaction.

The current query DTO deliberately refuses date ranges, with the stated reason that a loose range
would leave the response unable to say which month it describes. That objection is real and this
design has to answer it rather than ignore it.

## Goals / Non-Goals

**Goals:**
- Ask the report about an arbitrary date range, not only a calendar month.
- Ask about one employee, several, or everyone, through one parameter.
- Keep the reconcile against `GET /reports/monthly` checkable even when the caller filters.
- Change nothing for existing callers.

**Non-Goals:**
- Shift history. A past range is still recomputed with today's assignment; this change makes that
  caveat easier to hit, not fixed — see Risks.
- Attributing individual sales to a person directly. That would need a salesperson on `Income`, a
  schema and capture change far beyond this.
- Net profit per employee. `gross_profit` stays product profit and still does not subtract that
  person's salary or the shop's overhead.

## Decisions

### 1. Range support reuses the `resolveDateRange` shape from `/reports/monthly`
`year`+`month` **or** `start_date`+`end_date`, both optional, supplying both is a `400`, supplying
half of either is a `400`, supplying neither keeps today's behavior (current month in the business
zone). This pattern already exists in `ReportsController.resolveDateRange` and callers already know
it; inventing a second convention for the same idea would be the worse outcome.

Ranges are built with `startOfDayInZone` / `endOfDayInZone`, so the final day is included whole —
same as everywhere else.

### 2. `period.year` / `period.month` become nullable, filled only for a real calendar month
This answers the DTO's original objection directly. When the caller asks for `year`+`month`, or
when a supplied range happens to span exactly one calendar month in the business zone, both fields
are populated as today. For any other range they are `null`, and `start_date` / `end_date` — which
were always present — carry the period.

Rejected alternative: keeping them always populated by deriving the month from `start_date`. A range
of 15 Jan – 15 Feb would then announce itself as January, which is a wrong answer stated
confidently.

### 3. `employee_ids` is one optional array, not three parameters
Omitted means everyone (today's behavior). One element answers "how did this person do", several
answer "compare these". A separate `employee_id` scalar plus an `employee_ids` array plus an "all"
flag would be three ways to say one thing, with the interesting question of what happens when they
disagree.

Filtering happens **after** bucketing, never by narrowing the income query. Sales still have to be
attributed across every employee to know which fall to `unassigned`; filtering the query first would
silently reassign other people's days.

`unassigned` is returned when the caller did not filter, and omitted when they did unless
`include_unassigned: true` asks for it back. Otherwise asking about Luis returns Luis.

*Revised during implementation*: this was originally specified as a `null` entry inside
`employee_ids`. That reads well in JSON but does not survive a query string — `employee_ids=null`
is rejected by the `@IsInt({ each: true })` that guards the rest of the array, so the escape hatch
would have existed only over MCP and not over REST. A separate boolean works identically in both
transports and keeps the array honestly typed as numbers.

### 4. `totals` follows the rows; `period_totals` always covers everything
`totals` sums exactly the rows returned, which is what anyone reading a filtered response expects.
`period_totals` sums every employee plus `unassigned` for the same period, unconditionally.

This is what keeps the report honest under filtering. "Luis: 40,000" alone cannot be interpreted —
it could be nearly all of the period or a rounding error in it — and the reconcile that makes this
report trustworthy (`totals` must equal `GET /reports/monthly`) would quietly stop holding the
moment anyone passed a filter. With both blocks, the unfiltered case is unchanged
(`totals == period_totals`) and the filtered case states its own context.

### 5. A selected employee who is inactive is flagged, not silently zeroed
Inactive employees hold no `sales_days`, so an inactive person requested by id would come back with
`net_sales: 0` — indistinguishable from an active employee who sold nothing, and wrong in a way that
reads as fact. Their days now belong to someone else.

The row is returned with `active: false` so the difference is visible in the data rather than
inferred from its absence. An `employee_ids` entry matching no employee of this owner at all is a
`400`, because that is a typo or a stale id, not a fact about the business.

### 6. The tool mirrors the endpoint, profit included
`cogs`, `gross_profit` and `cost_data_coverage` are returned. The reason `sales_daily` deliberately
omitted profit — that it would smuggle an unguarded number into something labelled "sales" — does
not apply here: this report already publishes `cost_data_coverage` per row precisely so a profit
computed over sales with missing cost is readable as the ceiling it is.

### 7. Like `sales_daily`, the tool takes an explicit range and has no default period
The agent resolves what "last week" means and passes dates. Two notions of "current" in two places
disagree eventually, and the disagreement surfaces as a wrong period rather than an error.

## Risks / Trade-offs

- **[Risk]** Arbitrary ranges make the no-shift-history caveat much easier to hit: a range spanning
  a reassignment reports the whole span under today's owners, and a range crossing months hides it
  better than a month-at-a-time view did. → The caveat is already documented; this change restates
  it on the endpoint description and in `paldex-api/CLAUDE.md`, since a range is where it bites.
- **[Risk]** Filtering plus a range is exactly the combination that produces confident, wrong
  comparisons ("Luis beat Ana") when the two swapped days mid-range. → `sales_days` is returned on
  every row, so the assignment the number was computed under is visible next to the number.
- **[Risk]** `period_totals` doubles the aggregation work. → It is the same in-memory buckets summed
  a second way, not a second query; cost is negligible next to the income fetch.
- **[Trade-off]** `period.year` / `period.month` going nullable is a shape change for any consumer
  that reads them unconditionally. Accepted: the frontend passes `year`+`month`, where they stay
  populated exactly as before.

## Migration Plan

1. Ship service, DTO, entity and tool together — additive and backward compatible, no migration.
2. No role change: `report:read` is already granted to `ai_agent` from the daily-sales change.
3. Rollback is removing the tool registration; the endpoint's new parameters are optional and inert
   if unused.

## Open Questions

- Should a range longer than some cap be rejected, as `sales_daily` caps at 366 days? The row count
  here is bounded by the number of employees rather than by days, so response size is not the
  concern; the income scan still is. Leaning toward no cap until a slow query is actually observed.
