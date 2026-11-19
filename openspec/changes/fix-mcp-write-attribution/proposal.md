## Why

`ExpensesService.create()` writes `user_id: ctx.userId`, and for an MCP call `ctx.userId` is the owner
of the API key — the `ai_agent` service account. So every expense the agent records belongs to a
non-human system user: it is missing from the owner's `OWN`-scoped views, missing from the owner's
monthly report (the report filters with `buildOwnerFilter` exactly like the listings do), and wrong in
any export. The same trap is waiting for the payroll tools in `add-mcp-payroll-payments`, where a
payment is validated against `employee.user_id`.

Today this is masked only because the `ai_agent` role happens to hold `ANY` scope. That is the
dangerous kind of masking: the wrong attribution is invisible until someone tightens the role, and
tightening the role then silently changes where new records land.

The fix has to separate two things the code currently conflates in one field: **who is allowed to
call** and **whose books the row goes into**.

## What Changes

- `OwnershipContext` gains an optional `ownerUserId`. `buildOwnerFilter` filters by
  `ownerUserId ?? userId`; writes stamp `user_id: ownerUserId ?? userId`. Authorization is untouched:
  `McpAuthorizationService.requireContext` still resolves the **caller's** role and scope.
- `McpApiKey` gains a nullable `owner_user_id` — the account whose books a key acts on. A migration
  backfills `owner_user_id = user_id`, so existing keys behave exactly as before until an operator
  points one at a real person.
- The MCP controller resolves the key's owner once per request and passes both identities down, so
  tools do not have to (and cannot) choose.
- There is **no request field** that sets the owner. Attribution is a property of the credential, not
  of the payload: a model cannot forget it, and a compromised tool call cannot aim it at another
  account.
- The payroll write tools validate the employee against the ownership target, not against the caller.
- `ai_agent` can then drop `ANY` scope and hold `OWN` like a normal account — the recommended end
  state, documented but not enforced by this change.

## Capabilities

### New Capabilities
_None — this change fixes behaviour that the `data-ownership` capability already promises._

### Modified Capabilities
- `data-ownership`: ownership resolution gains an explicit "effective owner" that is allowed to differ
  from the authenticated caller, plus the rule that writes are stamped with it.
- `mcp-server`: tools receive both identities; the ownership target of a tool call is a property of its
  API key.

## Impact

- **Schema**: `mcp_api_keys.owner_user_id` (`Int?`, FK to `users`) + migration backfill.
- **Modified code**: `src/common/ownership.ts`, `src/expenses/expenses.service.ts` (and any other
  service printing `ctx.userId` into a row), `src/mcp/mcp.controller.ts`, `src/mcp/mcp-tools.service.ts`,
  `src/mcp-keys/*` (expose `owner_user_id` on create/update so it can be set).
- **Tests**: `ownership` unit tests, an MCP integration test proving a bound key writes rows the owner
  can see, and a negative test proving an unbound key keeps the old behaviour.
- **Ops**: one `PATCH`/SQL update per existing key after the migration (single-tenant today: one key).
- **BREAKING**: none for REST callers; MCP keys keep their current behaviour until `owner_user_id`
  is set.
