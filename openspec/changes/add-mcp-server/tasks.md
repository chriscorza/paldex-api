## 1. Module scaffolding

- [x] 1.1 Add `@modelcontextprotocol/sdk` (or equivalent) to `paldex-api/package.json`
- [x] 1.2 Create `src/mcp/mcp.module.ts` and wire it into `app.module.ts`
- [x] 1.3 Add `src/mcp/mcp.controller.ts` mounting the Streamable HTTP MCP endpoint (e.g.
      `POST /mcp`), left off `@Public()` so the global `AuthGuard` applies
- [x] 1.4 Add `src/mcp/CLAUDE.md` documenting the tool ↔ REST-endpoint pairing and the denylist,
      mirroring `src/shopify/CLAUDE.md`

## 2. Authorization plumbing

- [x] 2.1 Add `src/mcp/mcp-authorization.service.ts`: given a request user + a required
      `resource:action` permission string, call `PermissionsService.resolvePermissions` and throw
      the same way `PermissionsGuard` does on a miss, returning the effective scope on a hit
- [x] 2.2 Add a helper that applies `OWN` vs `ANY` scope to a service call identically to how the
      equivalent controller/service pair does it today (reuse existing scope-filtering code paths
      rather than reimplementing them) — satisfied by `requireContext` returning the same
      `OwnershipContext` shape `buildOwnerFilter`/services already consume; no separate helper
      needed
- [x] 2.3 Unit test `mcp-authorization.service` against: no permission, `ANY` scope, `OWN` scope,
      missing role

## 3. Example tools (read + write, prove the plumbing — nothing else this change)

- [x] 3.1 Implement tool `expenses_list` (`expense:read`, scope-aware) mirroring `GET /expenses`
- [x] 3.2 Implement tool `expense_create` (`expense:create`, scope `OWN` only — always attribute
      to the caller regardless of resolved scope) — turned out to already be guaranteed by
      `ExpensesService.create`, which writes `user_id: ctx.userId` unconditionally and takes no
      target-user input, so no override was needed; verified by a dedicated test
- [x] 3.3 Integration test: `expense_create` persists correctly and the created row is visible via
      both `GET /expenses` and the `expenses_list` tool afterward — implemented as an MCP-protocol
      round trip over `InMemoryTransport` (`create` then `expenses_list`) with `ExpensesService`
      mocked, in `mcp-tools.service.spec.ts`
- [x] 3.4 Explicitly do NOT implement any other tool (reports, incomes, accounts, cogs, employees,
      product costs, recurring expenses, payables, receivables, monthly-close) in this change —
      tracked as a follow-up change once 3.1–3.3 are verified

## 4. Denylist enforcement (structural)

- [x] 4.1 Write a test that enumerates the MCP tool registry and asserts no tool name/handler
      references `UserService`, `RolesService`, `PermissionsService` (as a target, not the
      authorization helper), `ShopifyConnectionService`, `InvitationsService`, `PayrollService`,
      `TaxPaymentsService`, or the `recalculate-costs` endpoint — trivially true today with only
      two tools, but the guard that keeps it true as the follow-up change adds more —
      implemented as a whitelist assertion ("exposes exactly expenses_list and expense_create") in
      `mcp-tools.service.spec.ts`, stronger than a denylist check for a 2-tool registry
- [ ] 4.2 Add this test to CI so a future tool addition touching one of those services fails the
      build, not just code review — **not done**: this repo has no CI workflow at all (no
      `.github/workflows`, no other pipeline config) for any module, so there's nothing to wire
      into without inventing CI infra outside this change's scope. The test runs under the
      standard `npm test` (jest picks up every `*.spec.ts`), so it's enforced locally/in review
      today; revisit if/when this repo gets a CI pipeline

## 5. Role & service account (manual, post-deploy — deliberately not code, see design.md
      "Migration Plan": credential creation stays out of version control)

- [x] 5.1 Create the `ai_agent` role via `POST /roles` with exactly `expense:read` and
      `expense:create` scoped `OWN` — done against the local dev stack (`docker compose up mysql
      api`): role id 7, permissions `[31, 32]` (`expense:read` OWN, `expense:create` OWN),
      verified via `PUT /roles/7/permissions` response
- [x] 5.2 Create the dedicated service-account user and assign the `ai_agent` role via
      `PATCH /user/:id/role` — done: invited `mcp-ai-agent@paldex.local` (`POST /invitations`,
      required by the invite-only-registration change), registered it (`POST /auth/user`), then
      `PATCH /user/9/role` to role 7
- [x] 5.3 Verify: `GET /roles/:id/permissions` for `ai_agent` contains only those two permissions
      — confirmed in the 5.1 response body
- [x] 5.4 Issue the service account's JWT to the MCP client/connector configuration (out of
      version control) — issued a real JWT via `POST /auth/login` and used it directly against
      `POST /mcp` for the verification below; nothing persisted to disk beyond this session

## 6. Verification

- [x] 6.1 End-to-end smoke test: connect an MCP client with the service-account JWT, list tools
      (expect exactly `expenses_list` and `expense_create`), call both — done for real over HTTP
      against the local dev stack: `tools/list` returned exactly `expenses_list` and
      `expense_create` with the service-account JWT; `expenses_list` and `expense_create` (via the
      admin account, which owns a test account/expense) round-tripped correctly — the expense
      created through the MCP tool matched byte-for-byte what `GET /expenses` returned afterward.
      Verification data (test account, test expenses, a throwaway zero-permission role/user) was
      cleaned up afterward; the `ai_agent` role and its service-account user were kept
- [x] 6.2 Negative test: connect with a JWT lacking `expense:read` and confirm the
      `expenses_list` tool fails with a permission error instead of returning data — done live:
      a user assigned a genuinely empty role got
      `{"content":[{"type":"text","text":"Missing permission: expense:read"}],"isError":true}`
      from `expenses_list` and the equivalent for `expense_create`; an unauthenticated request
      (no bearer token) got `401 Unauthorized` before reaching MCP at all. Also confirmed, as a
      bonus check not originally scoped here: the `ai_agent` service account's `OWN` scope was
      enforced at the business-logic level too, not just the permission gate — its
      `expense_create` call against an account id it doesn't own correctly failed with "Account
      with id 5 does not exist", identical to what `POST /expenses` would return for the same
      caller
- [x] 6.3 Negative test: confirm no tool call can reach payroll, tax payments, user/role
      management, or Shopify connection data — structurally guaranteed and tested (unit test), and
      confirmed live: calling a hypothetical `payroll_list` tool as the **admin** account (which
      holds every permission in the catalog) returned `MCP error -32602: Tool payroll_list not
      found` — the denylist holds even for a caller who could reach payroll over REST
- [x] 6.4 Update `paldex-api/CLAUDE.md` with a top-level pointer to `src/mcp/CLAUDE.md`, matching
      how the Shopify integration is referenced
