## ADDED Requirements

### Requirement: The report accepts a date range as well as a calendar month
`GET /reports/sales-by-employee` SHALL accept either `year` + `month` or `start_date` + `end_date`.
Supplying both forms SHALL be rejected, as SHALL supplying only one half of either. Supplying
neither SHALL report the current month in the business time zone, as before. Ranges SHALL include
the final day whole.

#### Scenario: A date range is honoured
- **WHEN** a caller requests `start_date=2026-08-10` and `end_date=2026-08-16`
- **THEN** only sales falling in those seven days, in the business time zone, are attributed

#### Scenario: Both period forms at once is rejected
- **WHEN** a caller supplies `year`, `month`, `start_date` and `end_date` together
- **THEN** the response is `400 Bad Request`

#### Scenario: Half a range is rejected
- **WHEN** a caller supplies `start_date` without `end_date`
- **THEN** the response is `400 Bad Request`

#### Scenario: No period still means the current month
- **WHEN** a caller supplies no period parameters
- **THEN** the report covers the current month in the business time zone

### Requirement: The declared period never states a month it does not cover
`period.year` and `period.month` SHALL be populated only when the period is exactly one calendar
month in the business time zone — whether requested as `year` + `month` or as a range that happens
to span it. For any other range they SHALL be `null`. `period.start_date` and `period.end_date`
SHALL always be populated.

#### Scenario: A month requested by year and month declares it
- **WHEN** a caller requests `year=2026` and `month=8`
- **THEN** `period.year` is 2026 and `period.month` is 8

#### Scenario: A range spanning exactly one month declares it
- **WHEN** a caller requests `start_date=2026-08-01` and `end_date=2026-08-31`
- **THEN** `period.year` is 2026 and `period.month` is 8

#### Scenario: A range that is not a whole month declares no month
- **WHEN** a caller requests `start_date=2026-01-15` and `end_date=2026-02-15`
- **THEN** `period.year` and `period.month` are both `null`, and the range is reported in
  `period.start_date` and `period.end_date`

### Requirement: Rows can be narrowed to selected employees
The report SHALL accept an optional `employee_ids` filter. When omitted, every employee with
assigned days SHALL be returned plus `unassigned`, as before. When supplied, only the requested
employees SHALL be returned, and `unassigned` SHALL be omitted unless `include_unassigned` asks for
it back.

Attribution SHALL happen across all employees before filtering is applied, so that filtering never
changes which employee a sale is credited to.

#### Scenario: One employee is requested
- **WHEN** a caller requests `employee_ids=[3]`
- **THEN** the response contains exactly one row, for employee 3

#### Scenario: Several employees are requested
- **WHEN** a caller requests `employee_ids=[3,5]`
- **THEN** the response contains exactly those two rows

#### Scenario: Filtering does not reassign sales
- **WHEN** the same period is requested filtered to one employee and unfiltered
- **THEN** that employee's figures are identical in both responses

#### Scenario: An unknown employee id is rejected
- **WHEN** a caller requests an `employee_ids` entry that matches no employee belonging to them
- **THEN** the response is `400 Bad Request`

#### Scenario: unassigned can be asked back while filtering
- **WHEN** a caller supplies `employee_ids` together with `include_unassigned: true`
- **THEN** the response contains those employees' rows and the `unassigned` row

### Requirement: The period's full totals are always reported
The response SHALL carry a `period_totals` block covering every employee plus `unassigned` for the
period, regardless of any filter, alongside `totals`, which SHALL sum exactly the rows returned.

#### Scenario: Filtered totals are distinguishable from the period's
- **WHEN** a caller filters to one employee who made part of the period's sales
- **THEN** `totals` reflects only that employee and `period_totals` reflects the whole period

#### Scenario: Unfiltered, both blocks agree
- **WHEN** a caller applies no filter
- **THEN** `totals` and `period_totals` are equal

#### Scenario: The period's totals still reconcile with the monthly report
- **WHEN** the period is a calendar month, filtered or not
- **THEN** `period_totals.net_sales` equals `net_sales` from `GET /reports/monthly` for that month

### Requirement: An inactive employee is reported as inactive, not as having sold nothing
Every row SHALL carry the employee's `active` state. An explicitly requested employee who is
inactive SHALL be returned with `active: false`, so a zero figure cannot be read as "sold nothing"
when the true cause is that their days now belong to somebody else.

#### Scenario: A requested inactive employee is flagged
- **WHEN** a caller requests an employee who exists but is inactive
- **THEN** the row is returned with `active: false` and zeroed figures

#### Scenario: Active employees are marked active
- **WHEN** any active employee's row is returned
- **THEN** `active` is `true`
