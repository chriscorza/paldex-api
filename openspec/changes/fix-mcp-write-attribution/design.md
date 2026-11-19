## Context

`OwnershipContext` is `{ userId, scope }` and is used for two different jobs at once:

1. **Authorization** — `requireContext(userId, permission)` reads the user's role and returns the
   scope that permission resolves to. This must stay keyed to the *caller*.
2. **Ownership** — `buildOwnerFilter(ctx)` filters reads, and write paths stamp `ctx.userId` into
   `user_id`. This must be keyed to the *account whose books these are*.

For a human logged in through the dashboard those are the same person, so nobody noticed. For an API
key held by a service account they are not: the caller is `ai_agent`, the books belong to the owner.
Every MCP write today lands in the wrong ledger.

A second constraint makes the obvious fix wrong: passing the owner's id into `requireContext` would
resolve **the owner's role**, handing the agent the owner's permissions. The agent's narrow role is
the entire point of `add-mcp-server`; the fix must not widen it.

## Goals / Non-Goals

**Goals**
- A row written by an agent lands in the owner's books and is visible to the owner's normal,
  `OWN`-scoped listings and reports.
- Authorization keeps resolving from the caller's role; nothing widens.
- Existing keys keep their current behaviour until someone deliberately rebinds them.

**Non-Goals**
- No multi-tenant delegation UI, no per-request `on_behalf_of` parameter, no impersonation in the
  REST API. This is about the credential, not about adding a new kind of request.
- No retroactive correction of rows already written with the wrong `user_id` (there is one test
  environment and, per the pre-flight in `add-mcp-payroll-payments`, no production payroll expenses;
  a data fix, if needed, is a one-line `UPDATE` run with the owner).
- No change to how permissions are resolved or granted.

## Decisions

### D1 — Two identities, one context object

`OwnershipContext` becomes:

```ts
interface OwnershipContext {
  userId: number;      // the authenticated caller — authorization only
  scope: 'OWN' | 'ANY';// resolved from the caller's role, unchanged
  ownerUserId?: number;// the account whose books are read/written
}
```

`buildOwnerFilter` and every write path use `ctx.ownerUserId ?? ctx.userId`. Untouched callers (REST,
dashboard) pass no `ownerUserId`, so their behaviour is byte-identical.

*Alternatives considered:*
- **Pass the owner id into `requireContext`.** Simplest to write and wrong: it resolves the owner's
  permissions, so the agent inherits them. Rejected.
- **Add a required `on_behalf_of_user_id` argument to the write tools.** The model has to supply it,
  which means it can omit it (silent misattribution), invent it (writes into a stranger's ledger), or
  be talked into changing it by anything that reaches the prompt. Attribution is a property of the
  credential, not a value in the request body. Rejected.
- **Rename the concept instead of extending it** (`ctx.tenantId`). Cleaner long-term, but it touches
  every service and every test for the same behaviour; not worth mixing into a correctness fix.

### D2 — Ownership target lives on the key

`McpApiKey.owner_user_id Int?` (FK `users`, nullable). Resolution at the MCP controller:

```
effectiveOwner = key.owner_user_id        // no call-time fallback
```

Migration backfill: `UPDATE mcp_api_keys SET owner_user_id = user_id WHERE owner_user_id IS NULL`, so
every existing key keeps behaving exactly as it does today (it acts as itself). The operator then
points the agent's key at the real owner.

`POST /mcp-keys` defaults `owner_user_id` to the creating user when the field is omitted, so a new key
is never owner-less. A key whose `owner_user_id` is somehow null (manual edit, older row that skipped
the backfill) is **refused on write** with a message naming the key and the field — it is never
silently treated as "the bot's books". The fallback lives in the migration, once, not in the request
path, where it would hide exactly the bug this change exists to fix.

### D3 — Validation of an FK target uses the effective owner

`validateForeignKeys` (expenses) and the payroll write tools check that the referenced account /
category / employee belongs to `ownerUserId`. This is what makes "the agent cannot file a bonus
against someone else's employee" true, and it is why the payroll change depends on this one.

### D4 — Audit without a new column per table

Adding `mcp_key_id` to every writable table is a schema tax on the whole model for a property of the
transport. Instead the MCP controller emits one structured log line per tool call —
`{ tool, key_id, caller_user_id, owner_user_id, outcome, row_id }` — which is enough to answer "who
created this, through which credential" alongside the row's `created_at`. If per-row provenance is
ever needed for compliance, it becomes its own change.

### D5 — `ai_agent` can stop using `ANY`

With attribution fixed, the recommended end state is `ai_agent` holding `OWN` on
`expense:read`/`expense:create`/`payroll:*`, because `ownerUserId` now supplies the filter. This change
does not force it (a role edit is an ops action), but the tasks include verifying the agent still sees
the right data with `OWN` scope, so the tightening is proven safe before anyone relies on it.

## Risks

| Risk | Mitigation |
|---|---|
| A write path keeps using `ctx.userId` and silently writes to the bot | Grep every `user_id: ctx.userId` and `buildOwnerFilter` call site; the integration test asserts the row's owner end-to-end |
| Someone rebinds a key to an account that should not receive writes | Binding is an admin action on `mcp-keys`, not reachable with a key itself (keys cannot hit `/mcp-keys`), and the endpoint validates the target user exists and is active |
| Backfill forgets a key | Backfill is part of the migration, not a script; a test asserts a pre-migration key keeps its old attribution |
| Reads change for a rebound key without anyone noticing | Documented in the key's API docs and in `src/mcp/CLAUDE.md`: rebinding changes both reads and writes, because both are "acting on that account's behalf" |

## Migration Plan

1. Deploy the schema change with the backfill (`owner_user_id = user_id`).
2. Verify the agent's key still reads and writes exactly as before (unbound-in-effect).
3. Rebind the agent's key to the owner (`PATCH /mcp-keys/:id` with `owner_user_id`).
4. Verify: an agent-created expense appears in the owner's `GET /expenses` under `OWN` scope.
5. Optionally tighten `ai_agent` to `OWN` scope and re-run step 4.

Rollback: set `owner_user_id = user_id` again — attribution returns to the previous (wrong but
pre-existing) behaviour without a code revert.

## Open Questions — resolved by the owner

1. `POST /mcp-keys` keeps `owner_user_id` **optional**, defaulting to the creating user at creation time.
2. **Yes**: create and rebind validate that the owner exists and is active. "Active" = the user exists and its invitation, if any, is not `REVOKED` (the bootstrap admin has no invitation and counts as active).
3. **Structured log only**, one line per tool call; no `mcp_tool_calls` table.

## Implementation decisions

- `isDelegated(ctx)` (`ownerUserId` set and different from `userId`) switches FK validation to strict owner-only, even under `ANY` scope. A backfilled key (`owner = user_id`) is not delegated, so it behaves exactly as before until rebound.
- A JWT on `/mcp` (testing) carries no key: no `ownerUserId`, acts as itself. A key with `owner_user_id = null` can read (as itself) but cannot write.
