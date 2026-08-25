## ADDED Requirements

### Requirement: An API key is shown once and stored only as a hash
Creating a key SHALL return the full token exactly once, in the creation response. The system
SHALL store only a non-reversible hash of the secret plus a plaintext lookup prefix, and SHALL NOT
provide any endpoint that returns a previously created token.

#### Scenario: The full token is returned at creation
- **WHEN** an authorized admin creates an API key
- **THEN** the response contains the full token in the form `pldx_<prefix>_<secret>`

#### Scenario: Listing keys never exposes the secret
- **WHEN** an authorized admin lists API keys
- **THEN** each entry shows the prefix, name, created/last-used/expiry/revoked timestamps
- **AND** no entry contains the secret or its hash

### Requirement: A valid API key authenticates on the MCP endpoint
`POST /mcp` SHALL accept a valid, unrevoked, unexpired API key presented as
`Authorization: Bearer pldx_...`, resolving it to its owning user in the same request shape a JWT
produces.

#### Scenario: A valid key is accepted
- **WHEN** an MCP client calls `POST /mcp` with a valid API key
- **THEN** the request is authenticated as the key's owning user and tools execute normally

#### Scenario: A JWT still works on the same endpoint
- **WHEN** an MCP client calls `POST /mcp` with a valid JWT instead of a key
- **THEN** the request is authenticated exactly as before this change

### Requirement: API keys are rejected everywhere except routes that opt in
A route SHALL accept an API key only if it is explicitly marked with `@AllowApiKey()`. On any
route lacking that marker, a request bearing an API key SHALL be rejected with `401 Unauthorized`
and SHALL NOT fall through to any other authentication path. Only `POST /mcp` carries the marker.

#### Scenario: A valid key is refused on a normal REST route
- **WHEN** a client calls `GET /expenses` with a valid API key whose owner has `expense:read`
- **THEN** the response is `401 Unauthorized` and no expense data is returned

#### Scenario: A valid key is refused on a sensitive route
- **WHEN** a client calls `GET /payroll` or `POST /roles` with a valid API key
- **THEN** the response is `401 Unauthorized`

### Requirement: A revoked or expired key stops working on the next request
Every request SHALL verify the key's `revoked_at` and `expires_at` at call time, with no caching.

#### Scenario: Revocation takes effect immediately
- **WHEN** an admin revokes a key that an agent is actively using
- **THEN** that agent's very next `POST /mcp` request is rejected with `401 Unauthorized`

#### Scenario: An expired key is rejected
- **WHEN** a client presents a key whose `expires_at` is in the past
- **THEN** the request is rejected with `401 Unauthorized`

#### Scenario: A revoked key is kept for audit
- **WHEN** an admin revokes a key
- **THEN** the row is retained with `revoked_at` set and still appears in the listing marked as
  revoked

### Requirement: A key authenticates but never authorizes
An API key SHALL grant no permission of its own. Authorization SHALL continue to resolve from the
owning user's role via `PermissionsService`, identically to a JWT-authenticated caller.

#### Scenario: The owning role still bounds the key
- **WHEN** the `ai_agent` role loses `expense:read` while an agent authenticates with a valid key
- **THEN** the `expenses_list` tool fails with a permission error on the next call, even though the
  key itself is still valid

#### Scenario: Two keys for the same user carry identical rights
- **WHEN** two API keys are issued to the same service account
- **THEN** both resolve to the same permissions, because permissions come from the user's role and
  not from the key

### Requirement: Rotation requires no downtime and no database access
Multiple simultaneously valid keys per user SHALL be supported, so a replacement can be put in
place before the old one is revoked.

#### Scenario: Rotating a key
- **WHEN** an admin mints a second key, swaps it into the connector, then revokes the first
- **THEN** the agent is authenticated continuously throughout, and the first key is rejected after
  revocation
