## Why

`add-mcp-server` authenticates the AI agent as a service-account **user**, which means handing the
agent an email and password. That is the wrong credential for a machine: the password is permanent
(it mints fresh JWTs forever), there is no endpoint to rotate it (`UpdateUserDto` has no password
field — rotating requires direct DB access), a leak makes the holder indistinguishable from the
agent, and a second consumer would have to share the same secret with no way to tell which one
called.

Revocation itself already works today and works well — stripping the `ai_agent` role's permissions
kills an already-issued token on its very next tool call, because every MCP tool call resolves
permissions from the DB. Verified live. The gap is not "can I cut off access" but "what credential
does the agent hold, and can I rotate or scope it without touching the database". `add-mcp-server`
listed exactly this as a Non-Goal and an Open Question; this change closes it.

## What Changes

- Add an `McpApiKey` model: a hashed, revocable token bound to a user, with a name, optional
  expiry, `last_used_at`, and `revoked_at`. **The agent never receives a password.**
- Token format `pldx_<prefix>_<secret>`: the prefix is stored in the clear and indexed for lookup,
  the secret is stored only as a hash. The full token is returned **once**, at creation, and is
  unrecoverable afterward.
- Admin-facing endpoints to mint, list, and revoke keys. Listing never returns the secret — only
  the prefix, so a key is identifiable in a connector config without being usable from the listing.
- `AuthGuard` accepts an API key **only on routes that opt in** via a new `@AllowApiKey()`
  decorator, applied solely to `POST /mcp`. A key is useless against every other REST route, so a
  leaked agent credential cannot be replayed against the rest of the API.
- Authentication only — **authorization is unchanged**. A key resolves to its owning user, and that
  user's role still governs every tool call through the existing `PermissionsService`. The
  `ai_agent` role remains the ceiling on what the agent can do.
- Rotation becomes real: mint a second key, swap it in the connector, revoke the first. No
  downtime, no shared secret, no DB access. **BREAKING**: none — additive; the existing JWT path
  keeps working.

## Capabilities

### New Capabilities
- `mcp-api-keys`: the key model, token format and hashing, the mint/list/revoke surface, and the
  rule that a key authenticates but never authorizes.

### Modified Capabilities
- `mcp-agent-access-control`: the service account's credential becomes a revocable API key rather
  than a password, and the revocation story gains a per-credential path alongside the existing
  per-role one.

## Impact

- **Schema**: one new model + migration (`npx prisma migrate dev --create-only` inside the
  container, per `paldex-api/CLAUDE.md`). New relation on `User`.
- **Auth**: `src/auth/auth.guard.ts` gains an API-key branch gated by `@AllowApiKey()`; this is the
  only change to an existing security-critical file and needs care — a bug here would widen auth
  for every route, so the opt-in check comes first.
- **Permissions**: new catalog entries `mcp_key:create`, `mcp_key:read`, `mcp_key:delete`.
- **New code**: `src/mcp-keys/` (service, controller, DTOs) and an `@AllowApiKey()` decorator.
- **Docs**: `src/mcp/CLAUDE.md` auth section rewritten; the "give the agent a password" instruction
  is removed so nobody follows it later.
