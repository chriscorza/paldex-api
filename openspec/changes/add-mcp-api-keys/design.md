## Context

`AuthGuard` today does one thing: `jwtService.verifyAsync` on a Bearer token, with no DB lookup.
`PermissionsGuard` and `McpAuthorizationService` do hit the DB per call, which is why revoking a
role's permissions cuts off an already-issued JWT immediately (verified live against the dev
stack). So the authorization side is already revocable and correct.

What is wrong is the credential the agent holds. `add-mcp-server` gave it the service account's
email + password, and a password is a permanent, unrotatable (no endpoint exists), unauditable,
non-delegatable secret. This change replaces it with a credential designed for machines.

The security-critical constraint: `AuthGuard` is global (`APP_GUARD`). Any change to it applies to
every route in the app, so widening it to accept a second credential type is the riskiest edit in
this change and must fail closed.

## Goals / Non-Goals

**Goals:**
- A revocable, rotatable, per-agent credential that never involves a password.
- Immediate revocation: a revoked key fails on the very next request.
- Keep authorization exactly as it is — the key identifies *who*, the role still decides *what*.
- Blast radius of a leaked key limited to the MCP endpoint.

**Non-Goals:**
- Full OAuth 2.0 / dynamic client registration (the MCP spec's other option). Enormous machinery
  for one known consumer; revisit only if third parties ever connect.
- Replacing JWT auth for humans. The frontend keeps using `/auth/login` untouched.
- Making API keys work across the whole REST API. Deliberately excluded — see decision #3.
- Per-key permission scoping (a key narrower than its user's role). The role is the scope; adding a
  second scoping layer would duplicate the permission system this project already has.

## Decisions

### 1. Token format `pldx_<prefix>_<secret>`, prefix indexed, secret hashed with SHA-256
The prefix (8 random chars, stored plaintext, indexed) makes lookup a single indexed query instead
of scanning every row and hashing against each. The secret (32 bytes from `crypto.randomBytes`,
base64url) is stored only as a SHA-256 hash and compared with `crypto.timingSafeEqual`.

*Why SHA-256 and not bcrypt/argon2*: those are deliberately slow to defend low-entropy human
passwords against offline cracking. This secret is 256 bits of CSPRNG output — brute force is
already infeasible, and bcrypt would add ~100ms to **every single tool call** for no security gain.
Fast hashing is the correct choice for high-entropy tokens; this reasoning must be kept in a
comment so a future reader doesn't "fix" it into bcrypt.

*The full token is shown once.* Storing it recoverably would make the DB a credential store; if
it's lost, mint a new one and revoke the old — that is what rotation is for.

### 2. The key authenticates; the role authorizes
A valid key resolves to `{ id, email }` and is placed on `request.user`, exactly the shape
`AuthGuard` already sets from a JWT payload. Everything downstream — `PermissionsGuard`,
`McpAuthorizationService`, `OwnershipContext` — is untouched and cannot tell the difference. The
`ai_agent` role remains the ceiling.

*Alternative considered*: per-key permission grants (a key with fewer rights than its user). Rejected
— it would create a second authorization system alongside `PERMISSION_CATALOG`, and the two would
drift. Want a narrower agent? Give it a user with a narrower role.

### 3. Keys work **only** on routes marked `@AllowApiKey()`, and only `POST /mcp` is marked
`AuthGuard` branches on the `pldx_` prefix. If the token is a key **and** the route lacks
`@AllowApiKey()`, it throws `UnauthorizedException` — it does not fall through to JWT verification
and does not silently allow. This ordering matters: the opt-in check happens before the key is even
looked up, so the default for every existing and future route is "keys don't work here".

The consequence is deliberate: a leaked agent key cannot read `/reports`, touch `/payroll`, or hit
any REST endpoint at all. It can only reach the MCP tool surface, which the denylist already
constrains. Two independent containments — the route opt-in and the tool registry — neither
depending on the other being right.

### 4. Revocation is a soft flag checked per request, never a delete
`revoked_at` is set; the row stays. Every request looks the key up and rejects if
`revoked_at != null` or `expires_at` has passed. Because the lookup is per request there is no
cache to invalidate and no window where a revoked key still works — matching how revoking role
permissions already behaves. Keeping the row preserves the audit trail (`last_used_at` tells you
whether a leaked key was actually used before you killed it), which a hard delete would destroy
precisely when it matters most.

### 5. `last_used_at` is throttled, not written every request
A write on every tool call would double the DB traffic of a read-only tool. It is updated only when
the stored value is older than 5 minutes — enough to answer "is this key still in use / when was it
last used" without turning every read into a write. Fire-and-forget: a failed `last_used_at` update
must never fail the request it is annotating.

## Risks / Trade-offs

- **[Risk]** `AuthGuard` is global — a mistake there affects every route in the app. → The
  `@AllowApiKey()` check runs before anything else and fails closed; a spec scenario asserts a
  valid key is rejected on a non-opted-in route, so a regression that widens this fails the build.
- **[Risk]** A leaked key is a bearer credential: whoever holds it is the agent until revoked. →
  Bounded by scope (MCP only), by the `ai_agent` role's two permissions, by optional `expires_at`,
  and revocable in one request with no DB access. Strictly better than the password it replaces,
  which had none of those properties.
- **[Risk]** The plaintext key must never reach a log, an error message, or the Swagger example. →
  Returned only in the creation response; `McpApiKey` entity projections expose `prefix` and never
  `token_hash`; a spec scenario covers the listing.
- **[Trade-off]** Two auth paths in one guard is more complexity than one. Accepted: the
  alternative is a machine using a human's credential, which is the actual problem being solved.

## Migration Plan

1. Migration for the new model (`--create-only`, reviewed, then applied) — additive, no backfill.
2. Deploy; both auth paths live. Nothing breaks: no key exists yet.
3. Mint a key for the existing `ai_agent` service account, put it in the connector config, confirm
   the agent works.
4. Then remove the service account's password (set `password: null` — the column is already
   nullable, as Google-login users have none), so email+password is no longer a way in at all.
5. Rollback: stop issuing keys; JWT auth is untouched throughout.

## Open Questions

- Should `expires_at` be mandatory with a default (say 90 days), forcing periodic rotation, or
  optional so a long-lived connector doesn't break unattended? Leaning optional-but-encouraged for
  now, since nothing yet watches for expiry and a silently dead agent at 3am is its own problem.
- Should minting a key require re-authentication (password confirmation) the way sensitive actions
  often do? Deferred — the admin already holds a full-privilege JWT, so it would be theater unless
  step-up auth exists project-wide.
