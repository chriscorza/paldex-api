## ADDED Requirements

### Requirement: Daily sales are reported per day over an explicit range
`GET /reports/sales-daily` SHALL require `start_date` and `end_date` and SHALL return one row per
calendar day in that range, each with `date`, `net_sales`, `gross_sales`, `discounts`, `fees`,
`shipping_charged` and `sales_count`, ordered by date ascending. It SHALL require `report:read` and
SHALL respect the caller's ownership scope.

#### Scenario: A range returns one row per day
- **WHEN** an authorized caller requests `start_date=2026-08-01` and `end_date=2026-08-07`
- **THEN** the response contains exactly 7 rows, dated 2026-08-01 through 2026-08-07 in ascending
  order

#### Scenario: Missing dates are rejected
- **WHEN** a caller requests the report without `start_date` or without `end_date`
- **THEN** the response is `400 Bad Request`

#### Scenario: An inverted range is rejected
- **WHEN** a caller requests a range whose `end_date` precedes its `start_date`
- **THEN** the response is `400 Bad Request`

### Requirement: Days are bucketed in the business time zone
Each sale SHALL be attributed to the calendar day it fell on in the business time zone
(`REPORTS_TIMEZONE`), never the server's zone and never UTC. Bucketing SHALL be performed in
application code, not by a SQL date function.

#### Scenario: A late-evening sale stays on its local day
- **WHEN** a sale is recorded at 19:00 on 2026-08-05 in `America/Mexico_City` (already 2026-08-06
  in UTC)
- **THEN** it is counted in the 2026-08-05 row, not 2026-08-06

#### Scenario: The report is unaffected by missing database timezone tables
- **WHEN** the report runs against a MySQL instance with no timezone tables loaded
- **THEN** the day buckets are still correct and no row reads zero for that reason

### Requirement: Days without sales appear as zero rows
Every date in the requested range SHALL be present in the response. A day with no sales SHALL be
returned with `sales_count: 0` and zeroed monetary fields, and SHALL NOT be omitted.

#### Scenario: A day with no sales is still listed
- **WHEN** the shop recorded no sales on 2026-08-03 and that date is inside the requested range
- **THEN** the response contains a 2026-08-03 row with `sales_count: 0` and `net_sales: 0`

### Requirement: The response carries totals for the whole range
The response SHALL include a totals block summing every returned day, so the caller need not sum
the series itself.

#### Scenario: Totals equal the sum of the rows
- **WHEN** any range is requested
- **THEN** each total equals the sum of that field across all returned rows

#### Scenario: Totals reconcile with the monthly report
- **WHEN** the requested range is exactly one calendar month
- **THEN** the `net_sales` total equals `net_sales` from `GET /reports/monthly` for that same month

### Requirement: The range is capped
A requested range longer than 366 days SHALL be rejected rather than truncated.

#### Scenario: An over-long range is rejected
- **WHEN** a caller requests a range spanning more than 366 days
- **THEN** the response is `400 Bad Request` and no partial series is returned
