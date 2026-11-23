## MODIFIED Requirements

### Requirement: The tool registry ships exactly one read tool and one write tool

The tool registry SHALL contain exactly these tools: `expenses_list` (read, requires `expense:read`),
`sales_daily` (read, requires `report:read`), `sales_by_employee` (read, requires `report:read`),
`income_statement` (read, requires `report:read`), `expense_create` (write, requires
`expense:create`, attributed to the key's `owner_user_id`), `payroll_list` (read, requires
`payroll:read`), `payroll_create` (write, requires `payroll:create`) and `payroll_pay` (write,
requires `payroll:update`).

A tool that creates, updates or deletes data SHALL be added only together with a written agent write
policy for its domain: who may call it, under which permission, and which ownership target the
written row gets. Two domains have such a policy today — expenses and payroll. Every other domain
remains read-only, including fixed assets, and the payroll **tax** domain is not part of payroll for
this purpose.

The registry test SHALL enumerate every tool and every write tool explicitly, so that adding a write
tool without touching the test is impossible.

#### Scenario: Listing tools returns exactly the eight tools

- **WHEN** an MCP client lists the available tools
- **THEN** the list contains exactly `expenses_list`, `sales_daily`, `sales_by_employee`, `income_statement`, `expense_create`, `payroll_list`, `payroll_create` and `payroll_pay`

#### Scenario: Every write tool has a declared permission

- **WHEN** the registry is inspected
- **THEN** each of `expense_create`, `payroll_create` and `payroll_pay` resolves a permission through `McpAuthorizationService.requireContext` before touching data

#### Scenario: Payroll taxes and fixed-asset writes remain unreachable

- **WHEN** the tool registry is inspected
- **THEN** there is no tool that creates or reads a payroll tax payment, a tax payment, a monthly-close write, a role, a user, an invitation, a Shopify credential, or that creates, updates or disposes of a fixed asset

## ADDED Requirements

### Requirement: The `income_statement` tool exposes the income statement

The `income_statement` tool SHALL require `report:read`, SHALL require explicit `start_date` and
`end_date` with no implicit period, and SHALL return the same `lines`, `summary`, `cash_items`,
`quality` and `warnings` as `GET /reports/income-statement` for the key's ownership target, by
calling the same service method.

#### Scenario: The tool returns the same data as its REST endpoint

- **WHEN** the agent calls `income_statement` with a date range
- **THEN** the result equals what `GET /reports/income-statement` returns for the key's `owner_user_id` over the same range

#### Scenario: Dates are mandatory

- **WHEN** the agent calls `income_statement` without `start_date` or `end_date`
- **THEN** the call fails with a validation error and no period is inferred
