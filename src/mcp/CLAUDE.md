# MCP module notes

The MCP surface an AI agent talks to. Transport, auth and the per-tool authorization plumbing came
from `openspec/changes/add-mcp-server`; tools are added one change at a time after that.

## Policy: everything except the denylist (expand-mcp-agent)

The agent can read and write every domain of the API **except a structural denylist**: users,
roles and permissions, invitations, MCP keys, the Shopify connection and its credentials (OAuth,
reconnection, cost recalculation), monthly-close writes (review, close, reopen) and authentication.
Those modules are not even imported by `McpModule`, so no role permission can make them reachable.
`monthly_close_status` only reads.

About 84 tools, one per action, declared per domain in `src/mcp/tools/<domain>.tools.ts`:
`context`/`reports`, `expenses` (+ recurring), `incomes` (+ COGS), `debts` (payables, receivables),
`taxes` (tax payments + tax catalog), `payroll` (+ employees), `assets` (fixed assets + product
costs), `config` (accounts, expense categories). `mcp-tools.service.spec.ts` enumerates **every
tool and every write tool**: adding one without touching that list fails the build.

**`PayrollPayment` is the only record of money paid to employees** and **`TaxPayment` the only
record of taxes paid**: neither is ever an expense. An expense whose category has `type = PAYROLL`
is refused everywhere with a 400 pointing to payroll; see `src/payroll/CLAUDE.md`.

## How a tool runs: `McpToolkit` (`toolkit.ts`)

A tool exists only through `toolkit.define({ name, kind, permission, input, dto, entity, handler,
load, targetId, dateOf, preWarnings })`, and every call goes through the same pipeline:

1. **Authorization** — `McpAuthorizationService.requireContext(callerUserId, permission)`, then
   writes are refused for a key with no `owner_user_id`. **Never register a tool another way.**
2. **Validation with the REST DTO** — `plainToInstance` + `validate` with `whitelist` and
   `forbidNonWhitelisted`, like the global `ValidationPipe`. zod only describes the schema to the
   model.
3. **Idempotency** (`create`) — `client_ref` is *reserved* in `mcp_actions` before the handler runs,
   so of two concurrent calls only one reaches the handler (the other gets "still in progress").
   A repeat returns the original entity with `duplicate: true`. A failed handler frees the reservation.
4. **Handler** — the same service method the REST endpoint uses, with the key owner's context.
5. **Warnings** — `CLOSED_MONTH` (the month is computed in the business zone; the write still
   happens, per the owner's decision) and `POSSIBLE_DUPLICATE` for expenses/incomes (same amount,
   ±3 days, same account/vendor/normalized concept; never blocks).
6. **Action log** — one `mcp_actions` row with the public projection before and after. Written
   after the domain write, not in its transaction: two failures → `ACTION_NOT_LOGGED` warning.
7. **Response** — writes return `{ entity, warnings, action_id }`; reads return the service result
   as-is. Errors come back as `isError` results whose text carries Nest's detail
   (`400: date must be a valid ISO 8601 date string`), so the agent can correct itself.

**Schemas are derived from the DTOs** (`dto-schema.ts` reads class-validator decorators and
`@ApiProperty` descriptions). Do not hand-write a zod schema next to a DTO: it drifts.

**Deletes are two-step and only for what the agent created.** A `*_delete` tool refuses (403) any
record with no `create` row in `mcp_actions` for a key of the same owner — what the owner typed in
the app cannot be deleted by the agent. Without `confirmation_token` it deletes nothing and returns
a preview plus an HMAC token (`JWT_SECRET`, bound to key, tool and id, 10-minute expiry). Edits,
payments and disposals need no confirmation (owner's decision).

**Bulk tools** (`expenses_create_bulk`, `incomes_create_bulk`, `product_costs_bulk`): up to 100
items, each through the single tool's whole pipeline; per-item `created | duplicate | error` plus a
summary. Resending the batch with the same `client_ref`s only adds what was missing.

**Shopify-managed incomes** (with `shopify_order_id`) are refused by `income_update`/`income_delete`:
the sync owns them. Their COGS can still be captured.

**`GET /mcp-actions`** (`mcp_action:read`, no `@AllowApiKey`) lists the log for the owner: what the
agent did, with before/after. A key cannot read or erase its own trail.

**Permissions for the `ai_agent` role**: `scripts/grant-ai-agent-permissions.ts` reads every tool's
permission from the registry and grants the missing ones with `OWN` scope (dry run by default,
`--apply` to write). `grant-permissions.spec.ts` checks every tool permission exists in the catalog
and that none is an admin permission.

**Tools take explicit date ranges, never a relative or implicit period.** Reports require
`start_date` and `end_date`; `context_get.today` gives the agent the business date to resolve
"this month". A second server-side notion of "current" would be a second clock.

**A filtered answer must still say what it is a fraction of.** `sales_by_employee` returns `totals`
for the rows it returned *and* `period_totals` for the whole period. Any future tool that grows a
filter should carry the same pair.

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

User/role/permission management, invitations, MCP keys, Shopify connection and credentials,
monthly-close writes and authentication have no tool — and their modules are not imported by
`McpModule`. Granting the `ai_agent` role a broader permission (by mistake or otherwise) must not
make any of those reachable over MCP. `mcp-tools.service.spec.ts` asserts it on tool names and
arguments; `grant-permissions.spec.ts` asserts no tool asks for an admin permission.

## Auth model

**The agent authenticates with an API key, never a password.** Mint one with `POST /mcp-keys` for
the `ai_agent` service account; the full token comes back exactly once and is unrecoverable
afterward. See `src/mcp-keys/`.

The endpoint also accepts a normal JWT, which is what makes it testable by hand, but never give
the service account a password: a password is permanent, mints fresh tokens forever, and there is
no endpoint to rotate one. The account's `password` should be left `null`.

The intended caller is a dedicated `ai_agent` role and service-account user, holding only the
permissions the current tool set needs. **`POST /mcp-keys/service-account`** (the "Crear cuenta del
asistente" button on the credentials screen) sets it up in one call: it creates or reuses the role
with exactly the registry's permissions in `OWN` scope (only adds, never removes), a service user
`asistente-ia-<owner>@agente.paldex.local` with no password and no invitation (it cannot sign in;
`AuthService.signIn` also refuses any user without a password), and a new key bound to the caller's
books. It requires `mcp_key:create`, `role:create`, `role:update` and `user:assign_role`, and never
accepts an API key. Never point a human user's JWT at this endpoint
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
  outcome, row_id }`, and every write also leaves an `mcp_actions` row (see above).

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
