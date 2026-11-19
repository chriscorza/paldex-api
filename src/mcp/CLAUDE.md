# MCP module notes

The MCP surface an AI agent talks to. Transport, auth and the per-tool authorization plumbing came
from `openspec/changes/add-mcp-server`; tools are added one change at a time after that.

## Write policy: only domains with an explicit agent write policy

A tool that creates, updates or deletes data is added **only together with a written agent write
policy for its domain**: who may call it, under which permission, and which ownership target the
written row gets (the key's `owner_user_id`). Two domains have one today:

- **Expenses** — `expense_create` (`expense:create`).
- **Payroll** — `payroll_create` (`payroll:create`), `payroll_pay` (`payroll:update`). Payroll
  **taxes** (`TaxPaymentType.PAYROLL_TAX`) are *not* payroll for this purpose and stay unreachable.

Every other domain is read-only. The registry test in `mcp-tools.service.spec.ts` enumerates every
tool **and every write tool** explicitly, so adding one without touching the test fails the build.
(History: `add-mcp-daily-sales` froze writes after `expense_create`; `add-mcp-payroll-payments`
replaced "never again" with this policy.)

**`PayrollPayment` is the only record of money paid to employees.** An expense whose category has
`type = PAYROLL` is refused everywhere (`ExpensesService.create/update`, recurring templates) with
a 400 pointing to `POST /payroll`; see `src/payroll/CLAUDE.md`.

## Tool ↔ REST pairing

| MCP tool | REST equivalent | Permission | Scope |
|---|---|---|---|
| `expenses_list` | `GET /expenses` | `expense:read` | scope-aware (`OWN`/`ANY`) |
| `sales_daily` | `GET /reports/sales-daily` | `report:read` | scope-aware (`OWN`/`ANY`) |
| `sales_by_employee` | `GET /reports/sales-by-employee` | `report:read` | scope-aware (`OWN`/`ANY`) |
| `expense_create` | `POST /expenses` | `expense:create` | attributes to the key's `owner_user_id` |
| `payroll_list` | `GET /payroll` | `payroll:read` | scope-aware; `start_date`/`end_date` required |
| `payroll_create` | `POST /payroll` | `payroll:create` | employee must belong to the key's owner; always `PENDING` |
| `payroll_pay` | `POST /payroll/:id/pay` | `payroll:update` | payment must belong to the key's owner; `paid_at` and `account_id` required |

Keep this table in sync with `src/mcp/mcp-tools.service.ts` — a hand-written tool list can drift
from the REST contract silently otherwise (see design.md "Risks").

**Tools take explicit date ranges, never a relative or implicit period.** `sales_daily` and
`sales_by_employee` require `start_date` and `end_date` and have no "current month" default. The
agent is the only party that knows what the user meant by "this month"; a second server-side notion
of "current" would be a second clock, and when the two disagree it surfaces as a silently wrong
period instead of an error.

**A filtered answer must still say what it is a fraction of.** `sales_by_employee` returns `totals`
for the rows it returned *and* `period_totals` for the whole period regardless of filtering. Without
that second block, "Luis: 40,000" cannot be interpreted — it could be nearly all of the period or a
rounding error in it — and the reconcile against `GET /reports/monthly` would stop holding the
moment anyone filtered. Any future tool that grows a filter should carry the same pair.

## Why one route, not `@RequirePermissions` per tool

`POST /mcp` (`src/mcp/mcp.controller.ts`) serves every tool through a single JSON-RPC endpoint,
so the usual `@RequirePermissions('resource:action')` route decorator can't gate an individual
tool call — the permission needed depends on which tool the client just invoked, not on the
route. The controller instead carries `@RequirePermissions()` with no arguments, the same
"authenticated, no specific permission" special case `/user/me` uses. Every tool handler then
calls `McpAuthorizationService.requireContext(userId, 'resource:action')` itself before touching
any data — same lookup `PermissionsGuard` does for REST, just invoked per-tool instead of
per-route. **Never register a tool that skips this call.**

## The denylist is structural, not a permission check

Payroll **taxes**, tax payments, user/role/permission management, Shopify connection credentials,
invitations, chart-of-accounts writes, monthly-close writes, and
`POST /reports/shopify/recalculate-costs` have no tool in `mcp-tools.service.ts` — full stop. This
is deliberate: granting the `ai_agent` role a broader permission (by mistake or otherwise) must
not make any of those reachable over MCP, because there is no code path into those services from
this file at all. `mcp-tools.service.spec.ts` asserts this by enumerating the registered tools —
if you add a tool, that test is what keeps this true.

## Auth model

**The agent authenticates with an API key, never a password.** Mint one with `POST /mcp-keys` for
the `ai_agent` service account; the full token comes back exactly once and is unrecoverable
afterward. See `src/mcp-keys/`.

The endpoint also accepts a normal JWT, which is what makes it testable by hand, but never give
the service account a password: a password is permanent, mints fresh tokens forever, and there is
no endpoint to rotate one. The account's `password` should be left `null`.

The intended caller is a dedicated `ai_agent` system-adjacent role and service-account user
(created manually via `/roles` and `/user`, not seeded — see design.md "Migration Plan"), holding
only the permissions the current tool set needs. Never point a human user's JWT at this endpoint
for anything but testing: the whole point of the `ai_agent` role is that its permissions are the
actual ceiling on what an AI agent can do here, narrower than what an admin or regular user can.

**A key authenticates, its role authorizes, and its `owner_user_id` decides whose books the call
touches — three separate things.** A valid key resolves to its service-account user (`user_id`);
`PermissionsGuard` and `McpAuthorizationService` cannot tell it from a JWT, and that user's role
still decides every tool call (permission *and* scope — never the owner's role). The key's
`owner_user_id` is the account whose books the tools read (`OWN` filter) and write (`user_id` of the
created row); it travels as `OwnershipContext.ownerUserId` and is read with `effectiveOwnerId(ctx)`.

- **No tool takes an owner argument.** Attribution is a property of the credential, not the payload;
  a model cannot forget it, invent it or be talked into changing it. The registry test asserts it.
- **A key with `owner_user_id = null` is refused on writes** (error names the key), never silently
  treated as the bot's books. Migrations backfill `owner_user_id = user_id`, so an existing key acts
  as itself until an operator rebinds it with `PATCH /mcp-keys/:id` (permission `mcp_key:update`).
- `POST /mcp-keys` defaults `owner_user_id` to the creating user; create and rebind validate the owner
  exists and is active (invitation not `REVOKED`).
- **Rebinding changes reads and writes**, because both are "acting on that account's behalf".
- When a call acts for another account, FK targets (accounts, categories, employees) must belong to
  that owner even if the caller's scope is `ANY` (`buildWriteTargetFilter`): scope widens what is
  *read*, not which books a row may be thrown into.
- Every tool call emits one structured log line `{ tool, key_id, caller_user_id, owner_user_id,
  outcome, row_id }` (no audit table; per-row provenance would be its own change).

**A key works only on `POST /mcp`.** `AuthGuard` rejects one on any route without
`@AllowApiKey()` — including `/mcp-keys` itself, so a leaked key cannot mint more. The opt-in is
checked *before* the key is looked up, so the default for every existing and future route is
"keys don't work here".

### Revoking access — two independent ways

| What you do | Effect | Kills a credential already in hand? |
|---|---|---|
| `DELETE /mcp-keys/:id` | That key stops working on its next request | **Yes, immediately** |
| Strip the role's permissions (`PUT /roles/:id/permissions`) | Authentication still succeeds, every tool call fails | **Yes, immediately** |
| Revoke the account's *invitation* | Blocks new logins only | **No — a live JWT keeps working up to 7 days** |

That third row is the trap, and it is why this exists. Revoking the invitation is the intuitive
"cut off access" move and it is the one that does **not** kill a token already issued: `AuthGuard`
verifies a JWT without touching the database, so nothing revokes it before it expires. The first
two work on the next request precisely because both hit the DB every call.

## Transport

Streamable HTTP (`@modelcontextprotocol/sdk`), stateless (`sessionIdGenerator: undefined`) — a new
`McpServer` + `StreamableHTTPServerTransport` pair is built per request (see
`simpleStatelessStreamableHttp` example bundled with the SDK), not shared across requests. This is
what lets each tool handler close over the authenticated caller's `userId` directly instead of
threading it through the SDK's OAuth-shaped `AuthInfo`.
