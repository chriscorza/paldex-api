# Payroll notes

## `PayrollPayment` is the only record of money paid to employees

One row per employee per period: gross, deductions, bonuses, net, the account it left and `paid_at`.
Lifecycle `PENDING` → `PAID`. This is the single source of `payroll_paid` in the monthly and profit
reports; the profit engine treats it as a peer of operating expenses
(`net = sales − (operating_expenses + payroll_paid)`).

**An expense with a `PAYROLL`-typed category is refused by design** — `ExpensesService.create/update`
and recurring-expense create/update call `assertCategoryNotPayroll` (`payroll-category.guard.ts`) and
answer `400` naming `POST /payroll` and `POST /payroll/:id/pay`. Why: the `PAYROLL` category sets
`affects_operating_profit: true`, so the same money would be counted in `operating_expenses` *and* in
`payroll_paid`; and recording payroll only as a payment would hide it from the expense breakdown if
both were allowed to coexist unreconciled. The guard lives in the services (not a controller
decorator) so `expense_create` over MCP is covered too.

- `PAYROLL` stays in the `ExpenseCategoryType` enum so historical rows and compiled clients keep
  working; it is simply unreachable for new expenses. The seeded "Nómina (manual)" category was
  retired (migration `retire_payroll_expense_category`, which aborts listing ids if any expense or
  recurring template still references a `PAYROLL` category). Pre-flight: `scripts/check-payroll-categories.ts`.
- The `[no-duplication]` test in `profit-engine.service.spec.ts` guards the report side. Do not weaken it.
- Ownership flows through `employee.user_id` (`PayrollPayment` has no `user_id`). MCP writes pass the
  context with the key's owner: `createManual` and `pay` require the employee (and the account) to
  belong to the **effective owner**, even under `ANY` scope (`buildWriteTargetFilter`).
- **Ownership by id (REST and MCP share one path).** Every by-id method is `(ctx, id, ...)` with a
  required `ctx` and resolves the payment through `findOwnedPayment` → `findFirst({ where: { id,
  employee: buildOwnerFilter(ctx) } })`. Another owner's id is a `404 Payroll payment not found`,
  identical to a missing one, and ownership is checked **before** state (a `409` on a foreign PAID
  payment would leak that it exists). `OWN` reaches only its owner's payments; `ANY` may read, edit,
  pay and delete any existing payment.
- **Writes point only at the effective owner's books, even under `ANY`.** `generate` (employees),
  `createManual` (employee, account) and `pay` (account: explicit, the payment's, or the employee's
  default) filter with `ownerBooks(ctx) = { user_id: effectiveOwnerId(ctx) }`. Do not swap in
  `buildWriteTargetFilter`: under `ANY` without delegation it returns `{}` and would let a generate or
  a payment hit other owners' books.
- **`PATCH /payroll/:id` cannot set `status: PAID`** (400 pointing to `POST /payroll/:id/pay`, which
  requires account and date); other transitions are unchanged. `UpdatePayrollPaymentDto` has no
  `employee_id`/`account_id`; a test fails if they are added without validation.
- `PayrollController.ctxOf` builds the context (`permissionScope || 'OWN'`, fail closed);
  `payroll-rest-ownership.spec.ts` has a structural guard that fails if a handler lacks `@Req`/`@CurrentUser`
  and uses a fake Prisma that evaluates nested `where` (the `matches` in `mcp-attribution.spec.ts` does not).
- Payroll **taxes** are a different domain and have no MCP path.
