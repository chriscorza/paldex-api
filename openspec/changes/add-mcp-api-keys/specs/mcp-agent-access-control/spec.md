## MODIFIED Requirements

### Requirement: A dedicated `ai_agent` role scopes what the MCP service account can do
A system-adjacent role named `ai_agent` SHALL exist, holding only the permissions the current
tool set needs — for this change, `expense:read` and `expense:create` scoped `OWN` — never a
permission ahead of the tool that uses it. A dedicated user account SHALL be assigned this role,
and the MCP server SHALL authenticate as that account rather than as any human user's account.

The service account SHALL authenticate using a revocable API key (see the `mcp-api-keys`
capability), never a password. Once a key is issued, the account's password SHALL be cleared so
that email-and-password is not a usable way in for the agent's identity.

#### Scenario: The role holds no permission unused by any tool
- **WHEN** the `ai_agent` role's permissions are inspected after this change ships
- **THEN** the only permissions present are `expense:read` and `expense:create` scoped `OWN`

#### Scenario: ai_agent role cannot be used to grant itself more access
- **WHEN** the `ai_agent` role's permissions are inspected
- **THEN** `role:update` and `user:assign_role` are not among them, so an agent authenticated as
  this role cannot alter its own or any other role's permissions

#### Scenario: The agent never holds a password
- **WHEN** the service account is inspected after its API key has been issued
- **THEN** its password is null, and `POST /auth/login` for that account fails

## ADDED Requirements

### Requirement: Agent access can be revoked at either the credential or the role layer
Revoking access SHALL be possible two independent ways, each effective on the next request:
revoking the agent's API key, or removing the permissions from its role. Neither SHALL depend on
the other being correct.

#### Scenario: Revoking the key alone cuts off access
- **WHEN** an admin revokes the agent's API key while the `ai_agent` role keeps its permissions
- **THEN** the agent's next `POST /mcp` request is rejected with `401 Unauthorized`

#### Scenario: Revoking the role's permissions alone cuts off access
- **WHEN** an admin removes all permissions from the `ai_agent` role while the agent's API key
  stays valid
- **THEN** the agent authenticates but every tool call fails with a permission error
