## Why

An AI agent (e.g. a finance assistant chatbot) needs programmatic access to Paldex's business
data — reports, incomes, expenses, inventory value — to answer questions and do light data entry
on the owner's behalf. Today the only integration surface is the REST API behind a full-privilege
JWT; there is no scoped, agent-safe way to expose "read almost everything, write almost nothing"
without handing over a token that can also touch payroll, tax filings, roles, or Shopify
credentials. This change adds an MCP (Model Context Protocol) server so an AI agent can be
connected with a deliberately narrow tool surface, reusing the deny-by-default permission system
that already exists instead of inventing a parallel auth model.

## What Changes

**This change ships the barebone MCP server only — transport, auth, and the authorization
plumbing — proven with one example read tool and one example write tool. The full tool catalog
(reports, incomes, accounts, cogs, employees, product costs, etc.) is deliberately deferred to a
follow-up change once this plumbing is validated end-to-end.**

- Add an MCP server (`src/mcp`) hosted inside `paldex-api`, exposing MCP tools that call the
  existing Nest services directly (not over HTTP-to-itself), so every tool call still passes
  through the same Prisma queries and money/timezone helpers the REST API uses.
- Ship exactly two tools as a proof of the plumbing: `expenses_list` (read, `expense:read`) and
  `expense_create` (write, `expense:create`, `OWN`-scoped). Every other domain tool — reports,
  incomes, accounts, cogs, employees, product costs, recurring expenses, payables, receivables,
  monthly-close status — is out of scope for this change.
- A **hard denylist** exists independent of the permission system: user/role/permission
  management, Shopify connection credentials, invitations, payroll, tax payments, monthly-close
  writes, chart-of-accounts writes, and `POST /reports/shopify/recalculate-costs` are never
  reachable from MCP, even if a misconfigured role would otherwise permit them. This is trivially
  true today (almost nothing is exposed yet) but is enforced as a standing test so it stays true
  as the follow-up change adds more tools.
- Introduce a dedicated system role (e.g. `ai_agent`) built from existing catalog permissions
  (no new permission entries needed — the catalog is already granular enough), scoped for now to
  just `expense:read` and `expense:create` (`OWN`), and a dedicated service account the MCP server
  authenticates as. **BREAKING**: none — this is additive.

## Capabilities

### New Capabilities
- `mcp-server`: the MCP transport, the per-tool authorization plumbing, and the two example tools
  (`expenses_list`, `expense_create`) that prove it end-to-end. The rest of the tool catalog is a
  follow-up change.
- `mcp-agent-access-control`: the denylist, the `ai_agent` role/service-account convention, and the
  rule that MCP tool authorization is derived from — never duplicated from — the existing
  permission catalog.

### Modified Capabilities
(none — no existing REST endpoint behavior changes)

## Impact

- **New code**: `src/mcp/` module (server bootstrap, tool definitions, tool→service adapters),
  wired into `app.module.ts`.
- **Permissions**: no new catalog entries — reuses existing `expense:read` / `expense:create`
  (see `src/permissions/permission-catalog.ts`). Later tools reuse the rest of the catalog the
  same way.
- **Roles**: one new system-adjacent role and one new service-account user, created via the
  existing roles/users admin flow — no schema migration expected.
- **Dependencies**: adds an MCP SDK package (e.g. `@modelcontextprotocol/sdk`) to `paldex-api`.
- **Docs**: `paldex-api/CLAUDE.md` gets a new section documenting the MCP surface and the
  denylist, mirroring how Shopify integration is documented today.
