## Context

Paldex's authorization model is deny-by-default: `AuthGuard` requires a JWT on every route, and
`PermissionsGuard` denies any route without an explicit `@RequirePermissions(...)` decorator,
resolving the caller's permissions from their role via `PermissionsService.resolvePermissions`
(cached per role, per process). That model works because each REST route is one handler with one
static permission requirement.

An MCP server doesn't fit that shape: a single transport endpoint multiplexes many *tools*, each
of which needs a different permission check, decided at call time from the tool name — not at
route-registration time from a decorator. The design problem is how to keep "deny by default,
checked against the real permission catalog" true for MCP without duplicating or drifting from the
REST authorization logic, while also guaranteeing that certain resources (payroll, tax payments,
user/role management, Shopify credentials) are **never** reachable over MCP even if a role is
later misconfigured to allow them.

## Goals / Non-Goals

**Goals:**
- Stand up the MCP transport, authentication, and per-tool authorization plumbing.
- Prove the plumbing end-to-end with exactly two tools: `expenses_list` (read, `expense:read`) and
  `expense_create` (write, `expense:create`, `OWN`-scoped).
- Reuse the existing permission catalog and `PermissionsService` for authorization instead of
  building a parallel rule engine.
- Make the sensitive-resource denylist structural (tools don't exist), not just a permission
  check that a future role change could accidentally satisfy — and prove it with a test now, so it
  keeps holding as more tools are added later.

**Non-Goals:**
- The full tool catalog (reports, incomes, accounts, cogs, employees, product costs, recurring
  expenses, payables, receivables, monthly-close status). Deferred to a follow-up change once this
  barebone plumbing is validated — see proposal.md.
- Building a general-purpose "expose any endpoint as a tool" framework. Tools are hand-written and
  enumerated; there is no auto-generation from the OpenAPI contract.
- Multi-tenant MCP (one server, many agents/orgs). One service account per Paldex deployment for
  now.
- Long-lived API keys / OAuth client-credentials for service accounts. Out of scope for this
  change; see Open Questions.

## Decisions

### 1. Transport: Streamable HTTP, mounted inside the existing Nest app
An MCP HTTP endpoint (e.g. `POST /mcp`) is added as an ordinary Nest controller, not a separate
process. It goes through the *same* global `AuthGuard` as every other route — no `@Public()`. This
means an MCP client must present a normal Bearer JWT, obtained the same way any Paldex user
obtains one today (`POST /auth/login`). No new authentication mechanism is introduced.

*Alternative considered*: stdio transport (spawn-per-agent-process). Rejected — Paldex is a hosted
API consumed by a remote agent, not a local CLI tool the agent spawns.

### 2. A dedicated `ai_agent` role + service-account user, not a new permission gate
A new system-adjacent role (not `is_system`, so it stays editable) is created via the existing
roles admin flow and granted only the permissions the current tool set needs: `expense:read` and
`expense:create` scope `OWN`. A dedicated user is assigned that role and its JWT is what the MCP
server holds. The follow-up change that adds the rest of the tool catalog extends this role's
permissions to match (`report:read`, `income:read`, `account:read`, `cogs:read`, `employee:read`,
`product_cost:read`/`create`/`update`, `recurring_expense:read`, `payable:read`,
`receivable:read`, `monthly_close:read`, `inventory:read`) — no permission is granted ahead of the
tool that uses it.

*Alternative considered*: add a new `mcp:connect` catalog permission as a gate on the transport
itself, independent of resource permissions. Rejected as redundant — it would just be one more
permission an admin has to remember to grant, on top of the role's existing scoping, without
stopping anything the role-based check doesn't already stop. The denylist (#3) is what actually
needs to be independent of role configuration, and it's enforced structurally instead.

### 3. The denylist is enforced by omission from the tool registry, not by a runtime check
Payroll, tax payments, user/role/permission management, Shopify connection credentials,
invitations, chart-of-accounts writes, monthly-close writes, and
`POST /reports/shopify/recalculate-costs` simply have no corresponding MCP tool. There is no code
path from an MCP tool call into those services at all. This means even if someone later grants the
`ai_agent` role `payroll:read` or points a differently-permissioned JWT at the MCP endpoint, there
is still no *tool* that reaches payroll — the denylist doesn't depend on the permission check being
correct.

### 4. Per-tool authorization mirrors `PermissionsGuard`, called explicitly per tool
Since one HTTP route serves many tools, `@RequirePermissions` (route-level metadata) can't gate
them individually. Each tool handler instead calls `PermissionsService.resolvePermissions(role_id)`
itself and checks the specific permission string the equivalent REST endpoint would require (e.g.
the `expenses_list` tool checks `expense:read`, exactly like `GET /expenses` does), applying the
resolved scope (`OWN` vs `ANY`) the same way the controller's service layer already does. This is
the same logic `PermissionsGuard` runs, just invoked per-tool instead of per-route — no new
authorization semantics, only a new call site. This mechanism is what the follow-up change reuses
for every additional tool, so it's the part worth getting right now.

### 5. Tools call services directly, not the REST API over loopback HTTP
MCP tool handlers inject the same Nest services (`ReportsService`, `IncomesService`,
`ExpensesService`, etc.) the controllers use, rather than issuing HTTP requests back into the app.
This avoids a self-loopback network hop and lets the tool handler pass the resolved permission
scope straight into the service call, matching exactly how a controller does it today.

## Risks / Trade-offs

- **[Risk]** A single shared JWT for the service account is long-lived-by-reuse (7-day expiry,
  same as any user token) but has no per-agent identity if multiple AI consumers exist later. →
  Acceptable for one MCP consumer; revisit if a second consumer appears (see Open Questions).
- **[Risk]** Hand-written tool list can drift from the REST contract (a report gets a new filter,
  the tool doesn't). → Document the pairing (tool ↔ REST endpoint) in `src/mcp/CLAUDE.md` so it's
  visible at review time, same spirit as the Swagger-from-DTOs contract.
- **[Risk]** `expense:create` is real write access — a malfunctioning or manipulated agent could
  still create garbage expenses. → It's `OWN`-scoped, additive (no delete/update-in-place tool),
  and lands in the same audit trail (`user_id`, `created_at`) as any human-entered row, so it's
  visible and reversible through the existing UI.
- **[Trade-off]** No auto-generation means every new tool is manual work. Accepted deliberately —
  auto-exposing new endpoints is exactly the failure mode this change exists to prevent.

## Migration Plan

1. Ship `src/mcp` module behind normal deploy (no flag needed — it's a new route, nothing existing
   changes behavior).
2. Create the `ai_agent` role and service-account user manually post-deploy (admin action via
   existing `/roles` and `/user` endpoints), not via seed/migration — keeps credential creation out
   of version control.
3. Issue the service account's JWT to the MCP client (e.g. as a connector secret in whatever
   platform hosts the AI agent).
4. Rollback is deleting the route / not registering `McpModule` — no data migration involved.

## Open Questions

- Should the service-account JWT be refreshed by a scheduled job before its 7-day expiry, or is
  manual re-issuance acceptable given how infrequently this will need to change?
- If a second AI agent/consumer shows up, do we need per-agent roles/users for auditability, or is
  one shared `ai_agent` account enough?
