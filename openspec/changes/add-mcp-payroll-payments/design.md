## Context

Three facts from the code shape every decision here.

1. `PayrollPayment` is a first-class model with its own lifecycle (`PENDING` → `PAID`) and its own
   money (`gross_amount`, `deductions`, `bonuses`, `net_amount`, `account_id`, `paid_at`). It is the
   only place where "what we owe each person this period" and "what actually left the account" are
   the same row.
2. The profit engine already treats payroll as a peer of operating expenses, not a member of it:
   `net = sales − (operating_expenses + payroll_paid)`, asserted by
   `[no-duplication] payroll paid does not alter operating_expenses`.
3. `ExpenseCategory.type = PAYROLL` sets `affects_operating_profit: true`, and the account seed ships
   a category named "Nómina (manual)" with that type. Nothing stops an expense from using it. So the
   code simultaneously says "payroll is separate" and "here is a payroll category for expenses".

That contradiction is the defect. The agent tools are the smaller half of this change.

## Goals / Non-Goals

**Goals**
- An agent can read payroll, create a manual payment (bonus, adjustment) and mark it paid, with the
  same permissions and visibility rules a human has.
- There is exactly one record of a payroll payment, and the profit engine cannot count it twice.
- Recording payroll as an expense fails loudly, at the boundary, with an instruction instead of a
  silent double count.

**Non-Goals**
- No change to payroll calculation, pay schedules, salary types or `payroll/generate` semantics.
- No payroll *tax* access over MCP (`TaxPaymentType.PAYROLL_TAX` remains denylisted).
- No history rewrite: no attempt to merge existing `PAYROLL` expenses into `PayrollPayment` rows
  automatically.
- No new permission strings; the payroll module's existing permissions are reused as-is.

## Decisions

### D1 — `PayrollPayment` is canonical; `PAYROLL` expenses are refused

`POST /expenses`, `PATCH /expenses/:id` and `POST /recurring-expenses` reject any category whose
`type` is `PAYROLL`, with `400` and a message naming the payroll endpoints to use instead.

*Alternatives considered:*
- **Make `PAYROLL` expenses non-operating** (`affects_operating_profit: false`). Cheap, and it kills
  the double count — but it leaves two ways to record the same money, one of which is invisible in
  the expense list and unreconcilable with the payroll report. It trades a loud bug for a quiet one.
- **Allow both and reconcile in the report** (subtract matching expenses). The report cannot know
  which expense matches which payment without a link column, so this needs a foreign key and a
  matching rule anyway — more work than forbidding it, and every mismatch becomes a silent wrong
  number.
- **Drop `PAYROLL` from the enum.** Breaks historical rows and every compiled client; Prisma enum
  removal is a migration on existing data. Not worth it for a value that only needs to become
  unreachable.

The column stays, the meaning narrows: `PAYROLL` is a *legacy* type that no new record may use.

### D2 — Guard placed in the services, not only on the REST routes

The rejection lives where the category is resolved and validated (`ExpensesService.create/update`,
recurring-expense creation), not in a controller decorator. `expense_create` over MCP calls the same
service; a controller-level guard would leave the MCP path unguarded — the exact class of bug this
codebase already avoids by making tools wrap services rather than reimplementing them.

### D3 — Retire "Nómina (manual)" in two moves

- Remove it from `SYSTEM_CATEGORIES`, so no new account is seeded with it (`seedSystemCategories`
  upserts per user, so this is not retroactive).
- A migration deletes the category rows for existing accounts, **but only when no expense references
  them**. The migration runs a `SELECT` guard first; if any expense still points at a `PAYROLL`
  category it aborts with the row ids rather than cascading a delete over real financial records.

Rationale: with `onDelete` behaviour unset, deleting a referenced category either fails (FK) or
orphans expenses depending on the relation — both are worse than refusing. A pre-flight script
(`scripts/check-payroll-categories.ts`, run manually against the target DB) reports the same thing
before the deploy, so the abort is not the first time anyone hears about it.

### D4 — Tools mirror REST, including the shape of the refusal

`payroll_list` returns the same paginated envelope `GET /payroll` returns (`data`, `total`, `page`,
`limit`), `payroll_create` takes `CreatePayrollPaymentDto` and `payroll_pay` takes `PayPayrollDto`.
No MCP-only fields, no partial entity: the point of the pairing rule in `src/mcp/CLAUDE.md` is that a
divergence between the two surfaces is a bug you can see, not a bug you discover in a report.

`payroll_pay` requires `paid_at` and `account_id` explicitly, the same way `sales_daily` requires
dates: the agent is the only party that knows *when* the owner paid and *from where*. A server-side
default of `now()` would invent facts.

### D5 — Ownership for payroll writes follows the employee

`PayrollPayment` has no `user_id`; ownership flows through `employee.user_id`
(`findAll` already filters `where.employee = { user_id: ctx.userId }` under `OWN`). A payment created
by the agent must therefore be validated against the employee's owner, not against the caller — which
is why this change depends on `fix-mcp-write-attribution` for the write-attribution half, and why the
guard here is written in terms of "the employee's owner" rather than `ctx.userId`.

### D6 — The MCP write policy is amended, not silently broken

`src/mcp/CLAUDE.md` and `specs/mcp-server/spec.md` currently say "every tool added from
`add-mcp-daily-sales` onward is read-only; `expense_create` is the only write". This change makes that
false, so it must say something different and testable:

> A tool that creates, updates or deletes data SHALL be added only together with a written agent write
> policy for its domain (who is allowed, under which permission, with which ownership target), and the
> registry test SHALL enumerate every write tool explicitly.

The registry test in `mcp-tools.service.spec.ts` already enumerates tools; it grows three entries and
keeps asserting the denylist (taxes, payroll taxes, monthly close, roles/users, invitations, Shopify
credentials) has no code path.

## Risks

| Risk | Mitigation |
|---|---|
| Owner has payroll expenses in production that never got reconciled | Pre-flight script + migration abort with row ids; the decision ("which side stays") is the owner's |
| Agent pays the wrong period because it guessed | `payroll_pay` requires explicit `paid_at`/`account_id`; `payroll_list` takes explicit date ranges, no "current period" default |
| Role wiring forgotten in a fresh environment, tools 403 | Tasks list the exact permissions; the tool error names the missing permission |
| Payroll tools drift from REST | Tools call the same services; a test asserts the tool output equals the REST service output for the same args |
| Someone reuses this change to justify other writes | Spec text names the two permitted domains explicitly and keeps the denylist as a structural requirement |

## Migration Plan

1. Run `scripts/check-payroll-categories.ts` against staging and production; if it reports expenses,
   stop and decide with the owner before deploying.
2. Deploy the code (guards + tools). Existing `PAYROLL` expenses, if any, keep working for reads.
3. Run the migration that removes unused "Nómina (manual)" rows.
4. Wire the `ai_agent` role: `payroll:read`, `payroll:create`, `payroll:update`.
5. Verify with the agent: list a period, create a negligible manual payment, pay it, delete it.

Rollback: the migration is a row delete on a category that no expense references; reverting the code
restores the previous behaviour and the seed re-creates the category on the next account seed. No
schema change, so no data-shape rollback.

## Open Questions — resolved (most conservative option, chosen by the implementer)

1. **`payroll_create` never creates a `PAID` payment.** It always creates `PENDING` (no `status` argument); marking paid is `payroll_pay` with explicit `paid_at` and `account_id`. Conservative: the agent cannot record money as having left in one unreviewed call, and it matches REST.
2. **The employee must belong to the key's owner (ownership target), regardless of scope.** Under `ANY` scope a bonus for another owner's employee is refused (`Employee not found`), not redirected to the employee's owner or the caller. Same for `payroll_pay` (404) and for `account_id`. Implemented with `buildWriteTargetFilter`.
3. **No new "not yet paid" filter.** `status=PENDING` with explicit dates is enough; `payroll_list` additionally *requires* `start_date` and `end_date` (stricter than REST, same rule as `sales_daily`).

## Implementation decisions

- `payroll_pay` exposes only `payment_id`, `paid_at`, `account_id`; `PayPayrollDto.net_amount` is deliberately not reachable by the agent (overriding the amount is a human decision).
- Migration abort uses a real guard table and a duplicate-key error whose text lists the offending ids (no `SIGNAL` without `DELIMITER`); it also covers recurring templates that reference a `PAYROLL` category, since deleting them would otherwise fail on the FK.
