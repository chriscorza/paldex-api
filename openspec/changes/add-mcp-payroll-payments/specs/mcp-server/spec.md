## MODIFIED Requirements

### Requirement: The tool registry ships exactly one read tool and one write tool

The tool registry SHALL contain exactly these tools: `expenses_list` (read, requires `expense:read`),
`sales_daily` (read, requires `report:read`), `sales_by_employee` (read, requires `report:read`),
`expense_create` (write, requires `expense:create`, attributed to the key's `owner_user_id`), `payroll_list`
(read, requires `payroll:read`), `payroll_create` (write, requires `payroll:create`) and `payroll_pay`
(write, requires `payroll:update`).

A tool that creates, updates or deletes data SHALL be added only together with a written agent write
policy for its domain: who may call it, under which permission, and which ownership target the
written row gets. Two domains have such a policy today — expenses and payroll. Every other domain
remains read-only, and the payroll **tax** domain is not part of payroll for this purpose.

The registry test SHALL enumerate every tool and every write tool explicitly, so that adding a write
tool without touching the test is impossible.

#### Scenario: Listing tools returns exactly the seven tools

- **WHEN** an MCP client lists the available tools
- **THEN** the list contains exactly `expenses_list`, `sales_daily`, `sales_by_employee`, `expense_create`, `payroll_list`, `payroll_create` and `payroll_pay`

#### Scenario: Every write tool has a declared permission

- **WHEN** the registry is inspected
- **THEN** each of `expense_create`, `payroll_create` and `payroll_pay` resolves a permission through `McpAuthorizationService.requireContext` before touching data

#### Scenario: Payroll taxes remain unreachable

- **WHEN** the tool registry is inspected
- **THEN** there is no tool that creates or reads a payroll tax payment, a tax payment, a monthly-close write, a role, a user, an invitation or a Shopify credential

## ADDED Requirements

### Requirement: The `payroll_list` tool exposes payroll payments

The MCP server SHALL expose a read-only tool `payroll_list` requiring `payroll:read`, taking the same filters as `GET /payroll` (`employee_id`, `status`, `date_field`, `start_date`, `end_date`, `page`, `limit`) and returning the same paginated envelope (`data`, `total`, `page`, `limit`) from the same service. It SHALL NOT mutate data and SHALL NOT default to any implicit period.

#### Scenario: The tool returns the same data as its REST endpoint

- **WHEN** an authorized caller invokes `payroll_list` with the same filters as `GET /payroll`
- **THEN** the result matches what that endpoint returns for those filters

#### Scenario: A caller without payroll:read is refused

- **WHEN** a caller whose role lacks `payroll:read` invokes `payroll_list`
- **THEN** the call fails with a permission error and no payroll data is returned

### Requirement: The `payroll_create` tool records a manual payroll payment

The MCP server SHALL expose a write tool `payroll_create` requiring `payroll:create`, accepting the same body as `POST /payroll` (`employee_id`, `period_start`, `period_end`, `scheduled_pay_date`, `gross_amount`, optional `deductions`, `bonuses`, `account_id`, `notes`) and creating the payment through the same service that serves the REST endpoint.

#### Scenario: An agent records a bonus payment

- **WHEN** an authorized caller invokes `payroll_create` for an employee with a period and a positive `bonuses` amount
- **THEN** a `PayrollPayment` row is created for that employee and period
- **AND** it is visible through `GET /payroll` and `payroll_list` afterwards

#### Scenario: An employee outside the caller's ownership is refused

- **WHEN** a caller invokes `payroll_create` for an employee that does not belong to the ownership target
- **THEN** the call fails and no payment is created

### Requirement: The `payroll_pay` tool marks a payment as paid

The MCP server SHALL expose a write tool `payroll_pay` requiring `payroll:update`, accepting a payroll payment id plus a required `paid_at` and `account_id`, and performing the same transition `POST /payroll/:id/pay` performs.

#### Scenario: Paying a pending period through the agent

- **WHEN** an authorized caller invokes `payroll_pay` on a `PENDING` payment with `paid_at` and `account_id`
- **THEN** the payment becomes `PAID` with those values recorded
- **AND** `payroll_paid` in the monthly report increases by its net amount while `operating_expenses` does not change

#### Scenario: The tool will not invent the payment date

- **WHEN** a caller invokes `payroll_pay` without `paid_at` or without `account_id`
- **THEN** the call fails and the payment keeps its previous status and values

#### Scenario: An already paid payment cannot be paid twice

- **WHEN** a caller invokes `payroll_pay` on a payment whose status is already `PAID`
- **THEN** the call fails and no second payment is recorded
