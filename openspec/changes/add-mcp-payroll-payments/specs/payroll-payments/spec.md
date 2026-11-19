## ADDED Requirements

### Requirement: `PayrollPayment` is the only record of money paid to employees

A `PayrollPayment` row SHALL be the single record of money paid to an employee for a period. The system SHALL refuse to create, update or schedule an `Expense` (directly or through a recurring-expense template) whose resolved category has `type = PAYROLL`, responding `400 Bad Request` and naming the payroll endpoints to use instead.

`PAYROLL` SHALL remain a valid value of `ExpenseCategoryType` so historical rows and compiled clients keep working; it SHALL NOT be reachable as the category of a new expense, and no account SHALL be seeded with a `PAYROLL` category.

#### Scenario: An expense filed as payroll is refused

- **WHEN** a caller creates an expense whose category has `type = PAYROLL`
- **THEN** the request fails with `400` and a message pointing to `POST /payroll`
- **AND** no expense row is created

#### Scenario: An existing expense cannot be re-filed as payroll

- **WHEN** a caller updates an expense and sets a category whose `type = PAYROLL`
- **THEN** the request fails with `400` and the expense keeps its previous category

#### Scenario: A recurring template cannot reintroduce payroll expenses

- **WHEN** a caller creates or updates a recurring expense with a category whose `type = PAYROLL`
- **THEN** the request fails with `400`
- **AND** no generated expense can appear in a later period through that template

#### Scenario: Removing the seeded category leaves no unused payroll category behind

- **WHEN** the migration runs on an account that has a `PAYROLL` category with no expenses referencing it
- **THEN** the category is deleted
- **AND** a new account seeded afterwards does not receive it

#### Scenario: A referenced payroll category blocks the migration

- **WHEN** the migration finds a `PAYROLL` category with at least one expense referencing it
- **THEN** the migration aborts and reports the offending category and expense ids
- **AND** it deletes nothing

### Requirement: Payroll paid stays out of operating expenses

The monthly and profit reports SHALL count payroll through `payroll_paid`, sourced from `PayrollPayment`, and SHALL NOT include it in `operating_expenses`. The existing `[no-duplication]` assertion for this SHALL keep passing after the payroll tools exist.

#### Scenario: Paying a payroll period does not move operating expenses

- **WHEN** a payroll payment is marked as paid for a period
- **THEN** `payroll_paid` increases by the net amount
- **AND** `operating_expenses` is unchanged

#### Scenario: The expense breakdown shows no payroll line

- **WHEN** a caller requests the monthly expense breakdown for a period that contains paid payroll
- **THEN** no payroll amount appears in it
- **AND** the payroll amount is reported by the payroll report and `payroll_paid`
