# MCP module notes

The MCP surface an AI agent talks to. Transport, auth and the per-tool authorization plumbing came
from `openspec/changes/add-mcp-server`; tools are added one change at a time after that.

## Tools are read-only from here on

`expense_create` is the **only** write tool and it is a legacy exception — every tool added since
is read-only, and no new one that creates, updates or deletes may be added
(`openspec/changes/add-mcp-daily-sales`). The registry test in `mcp-tools.service.spec.ts` asserts
this, so breaking the rule fails the build rather than passing review.

## Tool ↔ REST pairing

| MCP tool | REST equivalent | Permission | Scope |
|---|---|---|---|
| `expenses_list` | `GET /expenses` | `expense:read` | scope-aware (`OWN`/`ANY`) |
| `sales_daily` | `GET /reports/sales-daily` | `report:read` | scope-aware (`OWN`/`ANY`) |
| `sales_by_employee` | `GET /reports/sales-by-employee` | `report:read` | scope-aware (`OWN`/`ANY`) |
| `expense_create` | `POST /expenses` | `expense:create` | always attributes to the caller |

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

Payroll, tax payments, user/role/permission management, Shopify connection credentials,
invitations, chart-of-accounts writes, monthly-close writes, and
`POST /reports/shopify/recalculate-costs` have no tool in `mcp-tools.service.ts` — full stop. This
is deliberate: granting the `ai_agent` role a broader permission (by mistake or otherwise) must
not make any of those reachable over MCP, because there is no code path into those services from
this file at all. `mcp-tools.service.spec.ts` asserts this by enumerating the registered tools —
if you add a tool, that test is what keeps this true.

## Auth model

The MCP endpoint sits behind the same global `AuthGuard` as every other route — a normal Paldex
JWT Bearer token, obtained via `POST /auth/login` like any user. There is no separate MCP
authentication mechanism. The intended caller is a dedicated `ai_agent` system-adjacent role and
service-account user (created manually via `/roles` and `/user`, not seeded — see design.md
"Migration Plan"), holding only the permissions the current tool set needs: `expense:read` and
`expense:create` scoped `OWN`. Never point a human user's JWT at this endpoint for anything but
testing — the whole point of the `ai_agent` role is that its permissions are the actual ceiling
on what an AI agent can do here, narrower than what an admin or regular user account can do.

## Transport

Streamable HTTP (`@modelcontextprotocol/sdk`), stateless (`sessionIdGenerator: undefined`) — a new
`McpServer` + `StreamableHTTPServerTransport` pair is built per request (see
`simpleStatelessStreamableHttp` example bundled with the SDK), not shared across requests. This is
what lets each tool handler close over the authenticated caller's `userId` directly instead of
threading it through the SDK's OAuth-shaped `AuthInfo`.
