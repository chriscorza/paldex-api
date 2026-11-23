## Context

`McpToolsService` (`src/mcp/mcp-tools.service.ts`, about 390 lines) registers 8 tools in one file. Each one:
- calls `run()`, which authorizes with `McpAuthorizationService.requireContext`, refuses writes from a key with no owner, builds the `OwnershipContext` with `ownerUserId`, and logs one line per call;
- validates its arguments only with zod and passes them to the service as `args as SomeDto`, without `class-validator`.

The domain services already take an `OwnershipContext` and filter by owner (`buildOwnerFilter`, `buildWriteTargetFilter`), so reusing them keeps REST and MCP on one ownership path, as `payroll_pay` already does.

Going from 8 to about 80 tools turns three things that were acceptable with 3 writes into risks: one file, no DTO validation, and no record of what the agent did.

## Goals / Non-Goals

**Goals**
- The agent can capture and correct the day to day plus configuration, using the same services and validations as REST.
- Retries are safe (idempotency), mistakes are visible (log with before and after), and the agent can only delete what it created.
- The agent always has real ids at hand (`context_get` plus lists) instead of guessing them.

**Non-Goals**
- Images, an undo screen in the app, an agent inside Paldex, generic CRUD.

## Decisions

### 1. One tool per action, not a generic CRUD

Rejected alternative: `entity_create({ entity: 'expense', data: {…} })`.
- **Pro:** few tools.
- **Con:** the agent loses the schema for each entity (`data` would be `any`), each permission would be resolved from a parameter, and the registry test could no longer list what can be written.

Explicit tools keep every schema visible to the model and every permission fixed in code.

The cost is about 80 tools in the client's context. To keep it bounded:
- short descriptions (one sentence plus rules), with the long detail in each argument's `describe()`;
- consistent names: `<entity>_<verb>` and `<entities>_list`.

### 2. `McpToolkit`: one place for everything a tool needs

`src/mcp/toolkit.ts` exposes a single `defineTool({ name, permission, kind, input, dto, handler, annotations })`.

- `kind` is one of `read`, `create`, `update`, `delete` or `action`.
- It applies, in order:
  1. authorization (`requireContext` plus refusing writes from a key with no owner);
  2. `plainToInstance(dto, args)` and `validate()` with the same `whitelist` and `forbidNonWhitelisted` as the global `ValidationPipe`, so an argument REST would reject is also rejected here;
  3. idempotency, for `create`;
  4. the handler;
  5. date warnings;
  6. writing to `mcp_actions`;
  7. the uniform response.
- Tools are declared per domain in `src/mcp/tools/<domain>.tools.ts`. `McpToolsService` only gathers them. No tool can skip the toolkit, so none can skip authorization.

### 3. `mcp_actions`: action log

```
mcp_actions
  id, key_id (FK mcp_api_keys, nullable for JWT tests), caller_user_id, owner_user_id,
  tool, entity (e.g. 'expense'), entity_id, action ('create'|'update'|'delete'|'pay'|…),
  client_ref (nullable), before (JSON, nullable), after (JSON, nullable),
  created_at
  UNIQUE (owner_user_id, tool, client_ref)
  INDEX (owner_user_id, entity, entity_id)
```

- **It is not the REST audit trail.** It only records what came through MCP. It is enough for the three uses this change needs:
  - idempotency;
  - "delete only what it created";
  - "what did the agent do yesterday" (`GET /mcp-actions?start_date&end_date&entity`).
- **`before` and `after` are the service's public projection** (the same as the REST response), never Prisma rows. That keeps out fields that should not be duplicated, like `token_hash`, if such a field ever appears.
- **The log is written after the domain write, not in the same transaction.** Wrapping the services in a shared transaction would mean changing every service to accept a transactional client. The cost: if the log write fails, the record exists without a log entry. To shrink that window, a log failure is retried once and logged at `error` with the payload. The response then carries `warnings: [{ code: 'ACTION_NOT_LOGGED' }]` so the agent knows it cannot delete that record later.

### 4. Idempotency with `client_ref`

- Every `create` and `*_bulk` tool accepts an optional `client_ref` (string up to 100 characters).
- If `mcp_actions` already has `(owner_user_id, tool, client_ref)`, the toolkit does not run the handler. It returns the current entity (re-read by id) with `duplicate: true`.
- The tool description tells the agent to always send one, derived from the source: receipt folio, bank-statement line, invoice UUID, or a uuid it generates when there is no source.
- A race between two simultaneous calls with the same `client_ref` is settled by the unique index. The second one gets a P2002 and is converted into the `duplicate` response.

### 5. Possible duplicates without `client_ref`

- For `expense_create`, `income_create` and their bulk versions, before writing, the toolkit looks for records of the same owner with the same amount, a date within ±3 days, and the same account or vendor or concept (normalized: lowercase, no accents, no extra spaces).
- **The record is still created.** The response lists `warnings: [{ code: 'POSSIBLE_DUPLICATE', ids: [...] }]`. Blocking would break legitimate cases (two identical coffees on the same day). The agent is told to mention the warning to the person.

### 6. Deletion: only what it created, in two steps

A delete tool (`*_delete`, `payable_payment_delete`, `receivable_collection_delete`) works like this:

1. **Ownership check.** The entity must be the effective owner's, and `mcp_actions` must have a `create` for `(entity, entity_id)` made by **any key of that owner**. A key rotated after creating something can still delete it. If either fails, the error is `403` and says "this record was not created by the agent: delete it from the app".
2. **Without `confirmation_token`:** nothing is deleted. The response is `{ preview, confirmation_token, expires_at }`. The token is an HMAC (`JWT_SECRET`) over `(key_id, tool, entity_id, exp)` that expires in 10 minutes. Nothing is stored.
3. **With a valid token** for that same call: it deletes, and logs `delete` with `before`.

This is not foolproof: an agent that ignores its instructions could chain both calls without asking. But it forces the preview into the conversation, and together with `destructiveHint: true` it lets clients that support it ask the person for confirmation.

Everything else (edit, pay, dispose of an asset) needs no confirmation, per the owner's decision.

**"Delete" follows the domain's real semantics:**
- `employee_delete` deactivates, as `DELETE /employees/:id` does today;
- `account_delete` and `expense_category_delete` refuse if they have movements (the REST rule).

Each case is documented in the tool's description.

### 7. Closed months: write and warn

- The toolkit takes the domain date of each write (`date` or `paid_at` for expenses, `date` for incomes, `paid_at` for payments, `in_service_at` for assets). If that date's month is `CLOSED` for the owner, it adds `warnings: [{ code: 'CLOSED_MONTH', month: '2026-10', message }]`. The message says the close is now out of date and that only the owner can reopen it from the app.
- **The month is computed in the business time zone.** The existing `CloseGuard.ensureOpen` uses `date.getMonth()`, which reads the server's zone (UTC in the container) and puts the evening of the last day in the next month. The new check uses `dateKeyInZone`. Fixing `CloseGuard` itself is task 1.6 of this change, because recurring expenses use it.
- REST does not change behavior here.

### 8. Shopify-managed incomes

- Incomes with `shopify_order_id` belong to the sync.
- `income_update` and `income_delete` refuse them with an explanation ("this income comes from Shopify; it is fixed in Shopify and the next sync updates it").
- The exception is the cost of goods sold, which can be captured (`cogs_*`), as the app allows today.
- If the incomes service does not already enforce this rule for REST, it is enforced in the MCP layer, and a follow-up is opened for REST.

### 9. Bulk tools

- `expenses_create_bulk`, `incomes_create_bulk` and `product_costs_bulk` take up to 100 items, each with its own `client_ref`.
- **Per-item result, not all or nothing:** `{ results: [{ index, status: 'created'|'duplicate'|'error', entity?, warnings?, error? }], summary: { created, duplicates, errors } }`. On a bank statement, one bad row should not stop the other 99, and the agent can fix and resend only the failed ones (with the same `client_ref`, so it does not duplicate the ones that did go in).
- Each item goes through the same path as the single tool (validation, idempotency, warnings, log).

### 10. `context_get`

One read with `report:read` that returns:
- the books owner and today's date in the business zone;
- accounts (id, name, type);
- expense categories (id, name, type, flags);
- the tax catalog;
- active employees (id, name, frequency);
- closed months for the last 12.

Each part is filtered by owner and by the permission it needs. If the role lacks `employee:read`, `employees` comes back as `null` with a reason, so the agent does not take it for "no employees". The description tells the agent to call this tool at the start of every session and whenever it is missing an id.

### 11. Permissions for the `ai_agent` role

- The registry declares each tool's permission. `scripts/grant-ai-agent-permissions.ts` reads that list and grants exactly those permissions to the `ai_agent` role, in `OWN` scope. It is not run automatically: the owner runs it or does it by hand in `/roles`.
- Recommended: **`OWN` scope** on every permission, now that `fix-mcp-write-attribution` lets the key act on the owner's books.

## Risks / Trade-offs

- **Tool context size.** About 75 tools take several thousand tokens in the client. Mitigated with short descriptions. If it becomes a problem, the next step is splitting into two MCP servers (capture and administration), not merging tools.
- **The log is not transactional** (decision 3). Accepted, with a warning in the response.
- **The confirmation token is a speed bump, not a wall** (decision 6). The real wall is that the agent can only delete what it created.
- **Duplicate detection is a heuristic.** It warns and does not block. Real protection is `client_ref`.
- **Opening tax payments.** They used to be on the denylist as a precaution, not by rule. With validation parity, the log and owner attribution, they get the same treatment as payroll.

## Migration Plan

1. Additive migration: `mcp_actions`. Add `mcp_action:read` to `PERMISSION_CATALOG`.
2. Deploy. Existing tools keep working (their reads respond the same).
3. The owner runs `scripts/grant-ai-agent-permissions.ts` (or grants by hand) and checks with `tools/list` and `context_get`.
4. Rollback: removing the domain tools leaves `mcp_actions` unused but harmless.

## Open Questions

None blocking. The four owner decisions are in `proposal.md`.
