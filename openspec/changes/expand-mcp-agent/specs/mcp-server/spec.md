## MODIFIED Requirements

### Requirement: The tool registry ships exactly one read tool and one write tool

The tool registry SHALL expose every domain of the API to the agent except a structural denylist: users, roles and permissions, invitations, MCP keys, the Shopify connection and its credentials (including OAuth, reconnection and cost recalculation), monthly-close writes (review, close, reopen) and authentication. There SHALL be no code path from the MCP layer into any of those, whatever permissions the caller's role holds.

Every tool SHALL be declared through `McpToolkit.defineTool` with a fixed permission and a kind (`read`, `create`, `update`, `delete`, `action`). The registry test SHALL enumerate every tool and every write tool explicitly, so that adding one without touching the test fails the build.

#### Scenario: Listing tools returns exactly the registered set

- **WHEN** an MCP client lists the available tools
- **THEN** the list equals the enumerated registry in `mcp-tools.service.spec.ts`, and each tool carries `readOnlyHint`, `destructiveHint` and `idempotentHint` annotations consistent with its kind

#### Scenario: The denylist remains unreachable

- **WHEN** the tool registry is inspected
- **THEN** no tool name or argument reaches users, roles, permissions, invitations, MCP keys, Shopify credentials or connection management, monthly-close writes or authentication

## ADDED Requirements

### Requirement: Tools validate like their REST endpoint

Every tool that has a REST counterpart SHALL validate its arguments with the same DTO and the same `class-validator` options as the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), in addition to its zod schema, and SHALL call the same service method as the endpoint.

#### Scenario: An argument REST rejects is rejected over MCP

- **WHEN** the agent calls `expense_create` with an amount of `0`, which `CreateExpenseDto` rejects
- **THEN** the tool fails with the same validation message and nothing is written

### Requirement: Writes return a uniform envelope

Every write tool SHALL respond with `{ entity, warnings, action_id }`. `warnings` SHALL be an array, possibly empty, of `{ code, message, ... }`.

#### Scenario: A clean write

- **WHEN** the agent creates an expense in an open month with no similar records
- **THEN** the response carries the created expense, `warnings: []` and the id of its `mcp_actions` row

### Requirement: Idempotent creates

Every create and bulk tool SHALL accept an optional `client_ref`. A second call with the same `client_ref` for the same owner and tool SHALL NOT create anything and SHALL return the original entity with `duplicate: true`.

#### Scenario: Retry after a timeout

- **WHEN** the agent calls `expense_create` twice with `client_ref: "ticket-8841"`
- **THEN** one expense exists and the second response is that same expense with `duplicate: true`

#### Scenario: Concurrent duplicates

- **WHEN** two calls with the same `client_ref` arrive at the same time
- **THEN** exactly one record is created and the other call returns it as a duplicate

### Requirement: Possible-duplicate warning

`expense_create`, `income_create` and their bulk versions SHALL warn with `POSSIBLE_DUPLICATE` when the owner already has a record with the same amount, a date within three days and the same account, vendor or normalized concept, listing the matching ids. The record SHALL still be created.

#### Scenario: Same coffee twice

- **WHEN** the agent records an expense identical to one recorded the day before, without `client_ref`
- **THEN** the expense is created and the response warns `POSSIBLE_DUPLICATE` with the earlier id

### Requirement: The agent deletes only what it created, after confirming

A delete tool SHALL refuse with `403` any record that has no `create` in `mcp_actions` by a key of the same owner. Called without `confirmation_token`, it SHALL delete nothing and return a preview, a `confirmation_token` bound to that key, tool and record, and its expiry (10 minutes). Called with a valid token, it SHALL delete and log the deletion with the record's previous state.

#### Scenario: Deleting a record typed in the app

- **WHEN** the agent calls `expense_delete` on an expense the owner created in the app
- **THEN** the tool refuses with a message saying it must be deleted from the app

#### Scenario: Two-step deletion

- **WHEN** the agent calls `expense_delete` on an expense it created, first without and then with the returned token
- **THEN** the first call deletes nothing and returns the preview, and the second deletes it

#### Scenario: Expired or foreign token

- **WHEN** the token has expired or was issued for another record or tool
- **THEN** nothing is deleted and the error says to request a new preview

### Requirement: Writes into closed months warn

A write whose domain date falls in a month the owner has closed SHALL succeed and SHALL carry a `CLOSED_MONTH` warning naming the month and saying the close is now out of date. The month SHALL be computed in the business time zone.

#### Scenario: Late receipt for a closed month

- **WHEN** the agent records an expense dated October 31 at 20:00 in Mexico City and October is closed
- **THEN** the expense is created and the response warns `CLOSED_MONTH` for `2026-10`, not November

### Requirement: Bulk tools report per item

`expenses_create_bulk`, `incomes_create_bulk` and `product_costs_bulk` SHALL accept up to 100 items, process each through the same path as the single tool, and return a result per item (`created`, `duplicate` or `error`) plus a summary. One failing item SHALL NOT prevent the others.

#### Scenario: Bank statement with one bad row

- **WHEN** the agent sends 50 expenses and one has an account that does not belong to the owner
- **THEN** 49 are created, that one is reported as `error` with the reason, and resending the batch with the same `client_ref`s creates nothing new except the corrected row

### Requirement: Context in one call

`context_get` SHALL return the books owner, today's date in the business zone, accounts, expense categories, the tax catalog, active employees and the closed months of the last twelve, each filtered by owner. A part the caller's role cannot read SHALL come back as `null` with a reason, never as an empty list.

#### Scenario: Role without employee access

- **WHEN** the agent's role lacks `employee:read`
- **THEN** `employees` is `null` with a reason, and the other parts are returned

### Requirement: Shopify-managed incomes are read-only to the agent

`income_update` and `income_delete` SHALL refuse incomes linked to a Shopify order, explaining that they are corrected in Shopify and the sync updates them. Their cost of goods sold MAY still be captured through the `cogs_*` tools.

#### Scenario: Editing a Shopify order income

- **WHEN** the agent calls `income_update` on an income with a `shopify_order_id`
- **THEN** the tool refuses and nothing changes
