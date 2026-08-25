## ADDED Requirements

### Requirement: MCP endpoint requires authentication
The MCP transport endpoint SHALL require a valid Paldex JWT Bearer token, exactly as every other
non-public route does. The endpoint SHALL NOT be marked `@Public()`.

#### Scenario: Request without a token is rejected
- **WHEN** an MCP client sends a request to the MCP endpoint without an `Authorization: Bearer`
  header
- **THEN** the server responds `401 Unauthorized` and no tool is invoked

#### Scenario: Request with an expired or invalid token is rejected
- **WHEN** an MCP client sends a request with a token that fails JWT verification
- **THEN** the server responds `401 Unauthorized` and no tool is invoked

### Requirement: Each tool call is authorized against the real permission catalog
Before executing a tool's underlying service call, the MCP server SHALL resolve the caller's
permissions via `PermissionsService.resolvePermissions` (the same mechanism `PermissionsGuard`
uses for REST routes) and SHALL require the specific `resource:action` permission that the
equivalent REST endpoint requires, applying the resolved scope (`OWN` vs `ANY`) the same way that
endpoint's service layer does.

#### Scenario: Caller lacks the underlying permission
- **WHEN** an authenticated caller invokes a tool whose underlying permission (e.g. `report:read`)
  is not in their resolved role permissions
- **THEN** the tool call fails with a permission error and no data is returned

#### Scenario: Caller has only OWN-scoped permission
- **WHEN** an authenticated caller with `expense:create` scoped `OWN` invokes the create-expense
  tool
- **THEN** the created expense is attributed to the caller's own `user_id`, identical to how
  `POST /expenses` behaves for an `OWN`-scoped caller

### Requirement: The tool registry ships exactly one read tool and one write tool
This change SHALL expose exactly two tools, proving the transport and authorization plumbing end
to end: `expenses_list` (read, requires `expense:read`, SHALL NOT mutate any data) and
`expense_create` (write, requires `expense:create` scope `OWN`). No other tool SHALL exist in the
tool registry as part of this change; the rest of the tool catalog (reports, incomes, accounts,
cogs, employees, product costs, recurring expenses, payables, receivables, monthly-close status)
is added by a follow-up change, one tool at a time, using the same authorization mechanism.

#### Scenario: Listing tools returns exactly the two example tools
- **WHEN** an MCP client lists the available tools
- **THEN** the list contains exactly `expenses_list` and `expense_create`

#### Scenario: expenses_list tool matches the REST response shape
- **WHEN** an authorized caller invokes the `expenses_list` tool with the same parameters as
  `GET /expenses`
- **THEN** the tool returns the same fields that endpoint returns, sourced from the same service

#### Scenario: expense_create tool persists a new expense
- **WHEN** an authorized caller invokes the `expense_create` tool with a valid amount, category,
  and date
- **THEN** a new `Expense` row is created attributed to the caller, visible through
  `GET /expenses` (and through the `expenses_list` tool) afterward
