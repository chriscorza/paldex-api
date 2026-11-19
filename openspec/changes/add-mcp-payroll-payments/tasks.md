## 1. Pre-flight

- [x] 1.1 Add `scripts/check-payroll-categories.ts`: reports every `ExpenseCategory` with `type = PAYROLL` and the count of expenses referencing it, per account. Read-only, exits non-zero when the count is above zero.
- [ ] 1.2 Run it against local and staging; record the result in this file (`## Pre-flight result` at the bottom) before touching the migration.

## 2. Make `PayrollPayment` the canonical record

- [x] 2.1 Add a shared guard (e.g. `assertCategoryNotPayroll(category)`) that throws `BadRequestException` naming `POST /payroll` and `POST /payroll/:id/pay` as the correct path.
- [x] 2.2 Call the guard from `ExpensesService.create()` after `validateForeignKeys` resolves the category.
- [x] 2.3 Call the guard from `ExpensesService.update()` whenever `category_id` is present, so an expense cannot be re-filed as payroll either.
- [x] 2.4 Call the guard when creating and updating a recurring expense, so a template cannot regenerate the forbidden expense every month.
- [x] 2.5 Unit tests: create with a `PAYROLL` category → 400 with the guidance message; update to a `PAYROLL` category → 400; recurring expense with a `PAYROLL` category → 400; a normal `OPERATING` category still succeeds (the guard must not be a blanket refusal).
- [x] 2.6 Remove "Nómina (manual)" from `SYSTEM_CATEGORIES` in `expense-categories.service.ts`, leaving `DEFAULT_FLAGS.PAYROLL` in place for historical rows.
- [x] 2.7 Prisma migration: delete `ExpenseCategory` rows where `type = PAYROLL` and no expense references them; abort with the offending ids when any does.
- [x] 2.8 Test the migration against a seeded database with (a) an unused payroll category — deleted, (b) a referenced one — migration refuses.

## 3. Payroll tools over MCP

- [x] 3.1 Wire `PayrollService` into `McpToolsService` (`src/mcp/mcp.module.ts` already imports what the other tools need — verify the provider is reachable there).
- [x] 3.2 Register `payroll_list`: `payroll:read`, zod schema mirroring `FilterPayrollDto` (employee_id, status, date_field, start_date, end_date, page, limit), returns the same envelope as `GET /payroll`.
- [x] 3.3 Register `payroll_create`: `payroll:create`, zod schema mirroring `CreatePayrollPaymentDto` (employee_id, period_start, period_end, scheduled_pay_date, gross_amount, deductions?, bonuses?, account_id?, notes?), returns the created payment.
- [x] 3.4 Register `payroll_pay`: `payroll:update`, zod schema mirroring `PayPayrollDto` with `paid_at` and `account_id` **required**, returns the updated payment.
- [x] 3.5 Every tool calls `McpAuthorizationService.requireContext(userId, '<permission>')` before touching data — no exceptions.
- [x] 3.6 Tool descriptions state the read/write nature, the permission, that the employee must belong to the caller's owner, and that dates are explicit (no implied current period).
- [x] 3.7 Tests in `mcp-tools.service.spec.ts`: each tool rejects a caller without its permission; `payroll_pay` without `paid_at` fails instead of defaulting to now; `payroll_list` output equals the service output for the same filters.

## 4. Update the registry contract and docs

- [x] 4.1 Extend the registry enumeration test to seven tools: `expenses_list`, `sales_daily`, `sales_by_employee`, `expense_create`, `payroll_list`, `payroll_create`, `payroll_pay`.
- [x] 4.2 Extend the denylist assertion so it still proves there is no code path to payroll **taxes**, tax payments, monthly-close writes, roles/users, invitations or Shopify credentials.
- [x] 4.3 Rewrite the "tools are read-only from here on" section of `src/mcp/CLAUDE.md` to the policy in design D6, and add the three tools to the tool↔REST table with their permissions.
- [x] 4.4 Update the `mcp-server` delta spec so the registry requirement names all seven tools and the amended write policy.
- [x] 4.5 Document in `src/payroll/CLAUDE.md` (create it if missing) that `PayrollPayment` is the only record of money paid to employees and that `PAYROLL`-typed expenses are refused by design.

## 5. Permissions and verification

- [ ] 5.1 Grant the `ai_agent` role `payroll:read`, `payroll:create`, `payroll:update` in staging (`PUT /roles/:id/permissions`); confirm nothing else on the role changed.
- [ ] 5.2 End-to-end over MCP with the agent key: list a period, create a manual payment for a test employee, pay it with a real account and `paid_at`, then confirm it appears in `GET /payroll` and adds to `payroll_paid` in the monthly report **without** moving `operating_expenses`.
- [x] 5.3 Run `npm test` and `npm run lint` in `paldex-api`; run `openspec validate add-mcp-payroll-payments --strict`.
- [ ] 5.4 Verify the MCP endpoint lists seven tools against the deployed instance (`tools/list`).

## 6. Close-out

- [ ] 6.1 Remove the test payment created in 5.2.
- [ ] 6.2 Archive the change only after `fix-mcp-write-attribution` is applied or the follow-up is explicitly accepted (the payroll tools attribute writes through the employee's owner, which that change completes).

## Pre-flight result

2026-11-19 — **throwaway local MySQL 8.4 container only** (not staging, not production; none were touched): script exits `1` and lists `user 1 · categoría 1 "Nómina (manual)": 1 gastos, 0 plantillas recurrentes` when an expense references it, and exits `0` with `0 categorías PAYROLL` after the migration removed an unused one. **Step 1.2 against staging/production is pending the owner** (`DATABASE_URL=<target> npx ts-node scripts/check-payroll-categories.ts`).

## Implementation notes

- 2.8 verified with `prisma migrate deploy` on two throwaway databases: (a) unused PAYROLL category → deleted; (b) referenced → `Duplicate entry 'ABORTA: categorias PAYROLL en uso. category_ids=1 expense_ids=1 …'`, nothing deleted.
- 5.1, 5.2, 5.4 and 6.x touch staging/production (role permissions, end-to-end over MCP, `tools/list` on the deployed instance, test-payment cleanup, archive) and were not run; see the handoff list. The equivalent behavior is covered by in-memory tests (`mcp-attribution.spec.ts`, `mcp-tools.service.spec.ts`).
- Also needed after deploy: the `ai_agent` role keeps its existing permissions plus `payroll:read|create|update`; no seed change.
