## Why

The MCP surface can read expenses and sales but cannot touch the single biggest recurring outflow the
business actually pays every period: payroll. `PayrollPayment` carries gross, deductions, bonuses and
net per employee per period, and `POST /payroll/generate` + `POST /payroll/:id/pay` is the only place
that knows a period was closed and from which account it left. None of that is reachable by the agent,
so "pay the team this fortnight" and "did we already pay Luis in October" cannot be answered or acted
on through MCP.

Worse, there is a second, unofficial path that *is* reachable and silently double counts: the seeded
expense category **"Nómina (manual)"** has `type = PAYROLL`, and `PAYROLL` sets
`affects_operating_profit: true`. Filing payroll as an expense therefore feeds `operating_expenses`,
while the same money also feeds `payroll_paid` from `PayrollPayment`, and the profit engine adds both
(`net = sales − (operating_expenses + payroll_paid)`). Two records of one payment, counted twice. Go
the other way and record payroll only as a `PayrollPayment` and the money never appears in
`GET /expenses` or in the expense breakdown at all — it is invisible in the place people look for
"where did the money go".

The owner decided payroll is the canonical record. This change makes that true in code instead of by
convention, and opens exactly three payroll tools to the agent.

## What Changes

- Expose payroll through MCP, each tool mirroring its REST endpoint and reusing the same service:
  - `payroll_list` — read, `payroll:read`, mirrors `GET /payroll` (filters and pagination included).
  - `payroll_create` — write, `payroll:create`, mirrors `POST /payroll` (the manual payment path, i.e.
    bonuses and one-off adjustments).
  - `payroll_pay` — write, `payroll:update`, mirrors `POST /payroll/:id/pay`.
  Every tool requires explicit dates; none of them infers a "current period".
- **Payroll becomes the only way to record money paid to employees.** `POST /expenses` and
  `PATCH /expenses/:id` SHALL reject a category whose `type` is `PAYROLL` with a message that points
  to the payroll module. `POST /recurring-expenses` SHALL reject it too — a recurring template would
  otherwise regenerate the exact expense this rule forbids, every month, forever.
- **Retire the seeded "Nómina (manual)" category**: removed from `SYSTEM_CATEGORIES` so new accounts
  never get it, plus a data migration that deletes the row for existing accounts. The migration
  refuses to run silently if any expense still references a `PAYROLL` category — it aborts and prints
  the offending rows, because at that point the owner has money recorded twice and only a human can
  decide which side to keep.
- `PAYROLL` stays a valid `ExpenseCategoryType` in the enum (removing it would break historical rows
  and any client compiled against it); it simply stops being reachable as a *new* expense category.
- Leave `payroll_paid` out of `operating_expenses`. The existing `[no-duplication]` test in
  `profit-engine.service.spec.ts` already asserts this and stays as the guard; this change must not
  weaken it.
- Amend the standing rule in `src/mcp/CLAUDE.md` and `specs/mcp-server/spec.md`: MCP writes are no
  longer "never again", they are "only through a domain that has an explicit agent write policy".
  Today there are two such domains: expenses and payroll. Payroll **taxes**
  (`TaxPaymentType.PAYROLL_TAX`), tax payments, monthly-close writes, roles/users, invitations and
  Shopify credentials stay structurally unreachable — this change must not open any of them.
- The `ai_agent` role gains `payroll:read`, `payroll:create`, `payroll:update`. Nothing else on the
  role changes, and no new permission is invented.

## Capabilities

### New Capabilities
- `payroll-payments`: the canonical record of money paid to employees — manual payments, the
  pending→paid transition, and the rule that a `PAYROLL`-typed expense is refused everywhere.

### Modified Capabilities
- `mcp-server`: the tool registry grows from four tools to seven, and the write policy changes from
  "expense_create is the only write, forever" to "writes are allowed only where a domain declares an
  agent write policy".

## Impact

- **New code**: `payroll` registered in `McpToolsService` (three tools + zod schemas), a shared
  "reject PAYROLL category" guard used by expenses, recurring expenses and the MCP write path.
- **Modified code**: `src/mcp/mcp-tools.service.ts`, `src/mcp/CLAUDE.md`,
  `src/mcp/mcp-tools.service.spec.ts` (registry + denylist assertions),
  `src/expense-categories/expense-categories.service.ts` (drop the seed entry),
  `src/expenses/expenses.service.ts` and `src/recurring-expenses/*` (category guard).
- **Migration**: one Prisma migration deleting unused `PAYROLL` categories, guarded by a pre-flight
  check script.
- **Docs**: `GET /api-docs` picks the payroll endpoints up automatically (they already exist); the MCP
  tool table in `src/mcp/CLAUDE.md` is hand-written and must be updated by hand.
- **Permissions**: DB rows only (`PUT /roles/:id/permissions`) — no seed change, so a fresh
  environment still needs the role wired by hand.
- **BREAKING**: for anyone who currently files payroll as an expense, yes — that request now 400s.
  The migration guard is what keeps that from being a silent data loss.
