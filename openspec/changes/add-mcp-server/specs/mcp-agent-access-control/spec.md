## ADDED Requirements

### Requirement: Sensitive resources have no MCP tool, regardless of permissions granted
The MCP tool registry SHALL NOT contain any tool that reads or writes: users, roles, permissions,
Shopify connection credentials, invitations, payroll, tax payments, or monthly-close writes. It
SHALL NOT contain a tool wrapping `POST /reports/shopify/recalculate-costs`. This exclusion SHALL
be structural (no code path from any tool into these services) rather than enforced only by a
permission check, so that granting a role broader permissions cannot make these reachable through
MCP.

#### Scenario: Granting payroll:read to the agent role does not expose payroll over MCP
- **WHEN** the `ai_agent` role is (mis)configured with `payroll:read`
- **AND** an MCP client lists the available tools
- **THEN** no tool that reads or invokes payroll data appears in the list

#### Scenario: No tool reaches user or role management
- **WHEN** an MCP client lists the available tools
- **THEN** no tool creates, updates, deletes, or assigns roles to a user, and no tool creates,
  updates, or deletes a role or permission

### Requirement: A dedicated `ai_agent` role scopes what the MCP service account can do
A system-adjacent role named `ai_agent` SHALL exist, holding only the permissions the current
tool set needs — for this change, `expense:read` and `expense:create` scoped `OWN` — never a
permission ahead of the tool that uses it. A dedicated user account SHALL be assigned this role,
and the MCP server SHALL authenticate as that account rather than as any human user's account.

#### Scenario: The role holds no permission unused by any tool
- **WHEN** the `ai_agent` role's permissions are inspected after this change ships
- **THEN** the only permissions present are `expense:read` and `expense:create` scoped `OWN`

#### Scenario: ai_agent role cannot be used to grant itself more access
- **WHEN** the `ai_agent` role's permissions are inspected
- **THEN** `role:update` and `user:assign_role` are not among them, so an agent authenticated as
  this role cannot alter its own or any other role's permissions

### Requirement: The permission catalog is the single source of truth for MCP authorization
MCP tool authorization SHALL be derived from `PERMISSION_CATALOG` entries via
`PermissionsService`. No parallel permission list or hard-coded allow-list of user IDs SHALL be
introduced for MCP.

#### Scenario: A catalog permission change takes effect for MCP without code changes
- **WHEN** an admin removes `expense:create` (scope `OWN`) from the `ai_agent` role via
  `PUT /roles/:id/permissions`
- **THEN** the next create-expense tool call from that account fails with a permission error,
  without any change to the MCP server code
