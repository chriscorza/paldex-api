## MODIFIED Requirements

### Requirement: The tool registry ships exactly one read tool and one write tool
The tool registry SHALL contain exactly these tools: `expenses_list` (read, requires
`expense:read`), `sales_daily` (read, requires `report:read`), `sales_by_employee` (read, requires
`report:read`), and `expense_create` (write, requires `expense:create` scope `OWN`).

`expense_create` is the **only** write tool and remains the sole exception: every tool added from
the `add-mcp-daily-sales` change onward SHALL be read-only, and no further write tool SHALL be
introduced. A tool that creates, updates or deletes data SHALL NOT be added to the registry.

The rest of the catalog (incomes, accounts, cogs, product costs, recurring expenses, payables,
receivables, monthly-close status) is still added by later changes, one tool at a time, using the
same authorization mechanism.

#### Scenario: Listing tools returns exactly the four tools
- **WHEN** an MCP client lists the available tools
- **THEN** the list contains exactly `expenses_list`, `sales_daily`, `sales_by_employee` and
  `expense_create`

#### Scenario: expense_create remains the only write tool
- **WHEN** the tool registry is inspected
- **THEN** `expense_create` is the only tool that creates, updates or deletes data

#### Scenario: expenses_list tool matches the REST response shape
- **WHEN** an authorized caller invokes the `expenses_list` tool with the same parameters as
  `GET /expenses`
- **THEN** the tool returns the same fields that endpoint returns, sourced from the same service

#### Scenario: expense_create tool persists a new expense
- **WHEN** an authorized caller invokes the `expense_create` tool with a valid amount, category,
  and date
- **THEN** a new `Expense` row is created attributed to the caller, visible through
  `GET /expenses` (and through the `expenses_list` tool) afterward

## ADDED Requirements

### Requirement: The `sales_by_employee` tool exposes sales per employee
The MCP server SHALL expose a read-only tool `sales_by_employee` requiring `report:read`, taking
`start_date`, `end_date` and an optional `employee_ids`, and returning what
`GET /reports/sales-by-employee` returns for the same arguments, from the same service. It SHALL
NOT mutate any data and SHALL NOT accept a relative or implicit period.

#### Scenario: The tool returns the same data as its REST endpoint
- **WHEN** an authorized caller invokes `sales_by_employee` with a range
- **THEN** the result matches what `GET /reports/sales-by-employee` returns for that range

#### Scenario: The tool can be narrowed to selected employees
- **WHEN** a caller invokes the tool with `employee_ids`
- **THEN** only those employees' rows are returned, and `period_totals` still covers the whole
  period

#### Scenario: The tool requires an explicit range
- **WHEN** a caller invokes `sales_by_employee` without `start_date` or `end_date`
- **THEN** the call fails and no data is returned, rather than defaulting to any period

#### Scenario: A caller without report:read is refused
- **WHEN** a caller whose role lacks `report:read` invokes `sales_by_employee`
- **THEN** the tool call fails with a permission error and no sales data is returned
