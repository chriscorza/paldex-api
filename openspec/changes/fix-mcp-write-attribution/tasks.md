## 1. Context and schema

- [x] 1.1 Extend `OwnershipContext` in `src/common/ownership.ts` with `ownerUserId?: number`, and change `buildOwnerFilter` to filter by `ctx.ownerUserId ?? ctx.userId`.
- [x] 1.2 Audit every write path that stamps `user_id: ctx.userId` (`expenses`, `incomes`, `accounts`, `recurring-expenses`, `payables`, `receivables`, and anything else) and switch it to `ctx.ownerUserId ?? ctx.userId`.
- [x] 1.3 Prisma: add `owner_user_id Int?` to `McpApiKey` with an FK to `users` and an index.
- [x] 1.4 Migration with backfill: `UPDATE mcp_api_keys SET owner_user_id = user_id WHERE owner_user_id IS NULL`, in the same migration file, after the column exists.

## 2. Key ownership

- [x] 2.1 `CreateMcpKeyDto`: accept optional `owner_user_id`; when omitted, default to the creating user's id at creation time (not at call time).
- [x] 2.2 Expose `owner_user_id` in the key representation returned by `GET /mcp-keys` and accept it on `PATCH`/update so an operator can rebind without SQL.
- [x] 2.3 Validate on create and on rebind that the target user exists and is active; reject otherwise with a message naming the user id.
- [x] 2.4 Never accept the owner from an MCP tool payload — `POST /mcp` has no such field and the tools must not gain one.

## 3. Resolve both identities in the MCP controller

- [x] 3.1 In `src/mcp/mcp.controller.ts`, load `owner_user_id` alongside the key, and pass it into `McpToolsService.buildServer(...)` together with the caller id.
- [x] 3.2 Refuse a tool call whose key has a null `owner_user_id` with a clear error ("key has no owner_user_id; rebind it") — do not fall back to the caller.
- [x] 3.3 Make every tool build its context as `{ ...ctxFromCaller, ownerUserId: effectiveOwner }` while `requireContext` keeps taking the **caller's** id, so the scope still comes from the agent's role.
- [x] 3.4 Emit one structured log line per tool call: `{ tool, key_id, caller_user_id, owner_user_id, outcome, row_id }`.

## 4. FK validation uses the effective owner

- [x] 4.1 `ExpensesService.validateForeignKeys` resolves accounts, categories and taxes against `ownerUserId`.
- [x] 4.2 Same for incomes, payables, receivables and recurring expenses (whichever the agent can write; at minimum every write tool that exists after `add-mcp-payroll-payments`).
- [x] 4.3 The payroll write tools validate `employee_id` against `ownerUserId` — a bonus against another owner's employee is refused.

## 5. Tests

- [x] 5.1 Unit: `buildOwnerFilter` with and without `ownerUserId`; with `ownerUserId` under `ANY` scope the filter is still empty (scope wins), under `OWN` it filters by the owner.
- [x] 5.2 Integration (in-memory: real MCP protocol + real ExpensesService over a fake Prisma that applies `where`; no DB in this environment): a key bound to user A invoking `expense_create` produces an expense with `user_id = A`, visible in A's `GET /expenses` under `OWN` scope and counted in A's monthly report.
- [x] 5.3 Integration: the same key without `owner_user_id` is refused on write and creates nothing.
- [x] 5.4 Integration: a key bound to A cannot file an expense against one of B's accounts (`400`).
- [x] 5.5 Integration: an `ai_agent` role reduced to `OWN` scope still reads the owner's data (`payroll_list`, `expenses_list`) and can still write.
- [x] 5.6 Regression: REST calls (no `ownerUserId`) behave exactly as before — attribution unchanged.

## 6. Documentation and rollout

- [x] 6.1 Update `src/mcp/CLAUDE.md`: "a key authenticates, its role authorizes, and its `owner_user_id` decides whose books the call touches — three separate things".
- [x] 6.2 Update the `data-ownership` delta spec and the `mcp-server` delta spec.
- [x] 6.3 Run `npm test` and `npm run lint`; run `openspec validate fix-mcp-write-attribution --strict`.
- [ ] 6.4 In production: verify the agent key still works after the backfill (behaves as itself), then rebind it to the owner and repeat the read + write verification.
- [ ] 6.5 After rebinding, confirm an agent-created expense shows up in the owner's dashboard and monthly report; then optionally drop `ai_agent` to `OWN` scope and re-verify.

## Implementation notes

- 4.3 is completed in `add-mcp-payroll-payments` (the tools do not exist yet); the service-side guard (`PayrollService.createManual/pay` validate employee and account against the effective owner via `buildWriteTargetFilter`) ships here.
- 6.4 / 6.5 are production operations (rebind the agent's key, verify) and are left for the owner; not run from code.
- `PATCH /mcp-keys/:id` needs the new permission `mcp_key:update` (added to the catalog; grant it to the admin role).
- Finding, not fixed (REST behavior change): `PayrollController.findOne/update/pay/remove` take no ownership context, so any holder of the permission can touch another owner's payment by id. MCP tools pass the context.
- Resolved by `fix-payroll-rest-ownership`: the REST gap above is closed (`ctx` required on `findOne/update/pay/remove`, foreign id → 404, writes pinned to the effective owner's books).
