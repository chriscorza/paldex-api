## Why

The owner wants to run Paldex's daily bookkeeping through an AI agent: "register these receipts", "this supplier invoice is due on the 15th", "fix the amount on yesterday's expense", "load this bank statement". Today the MCP server has 8 tools. Five read (expenses, daily sales, sales by employee, income statement, payroll) and three write (create an expense, create and pay payroll). Everything else still has to be typed into the app.

The REST API already does all of it, across about 100 endpoints in 20 modules. What is missing is a safe way to hand that to an agent. Opening the endpoints one by one would not be enough, because an agent makes three kinds of mistakes a person rarely makes:
- **It retries.** A timeout followed by a retry records the same expense twice.
- **It guesses ids.** Writing to `account_id: 1` without knowing that account 1 is somebody else's card.
- **It acts on a misunderstanding.** Deleting the wrong record because "the last one" meant something else.

This change opens almost every domain to the agent, and adds the infrastructure that keeps those three mistakes from turning into wrong books.

## What Changes

### Owner decisions (2026-11-23)

1. **The agent can edit any record, but can only delete what it created itself**, and only with a two-step confirmation.
2. **A closed month does not block the agent.** The write goes through, and the response warns that the month was closed and its close is now out of date.
3. **The agent can also manage configuration**: accounts, expense categories and the tax catalog.
4. **There are bulk tools with duplicate detection** (bank statements, batches of receipts).

### Infrastructure (applies to every tool)

- **Action log `mcp_actions`.** Each write records:
  - the key, the tool, the entity and its id, and the action (`create`, `update`, `delete`, `pay`…);
  - the state before and after;
  - its idempotency key.

  This is what makes "delete only what it created" possible, and what lets the owner see and undo what the agent did.
- **Idempotency.** Every create accepts a `client_ref`. Repeating a call with the same `client_ref` returns the original record marked `duplicate: true` and creates nothing.
- **Possible duplicates.** Even without a `client_ref`, an expense or income with the same amount, a date within ±3 days and the same account or vendor comes back with a `possible_duplicate` warning. The record is still created.
- **Two-step deletion.** The first call returns what would be deleted plus a `confirmation_token` that expires in 10 minutes. Only the second call, carrying that token, deletes. The agent cannot delete without first showing the person what it is about to delete.
- **Same validation as REST.** Besides the zod schema (which the agent reads), every argument goes through the same DTO with `class-validator` as the matching endpoint. Today the tools only validate with zod and cast the result to the DTO.
- **Closed-month warning.** If the record's date falls in a closed month, the write still happens and the response carries `warnings: [{ code: 'CLOSED_MONTH', … }]`.
- **Uniform write response:** `{ entity, warnings, action_id }`.
- **MCP annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) on every tool, so the client can ask the person for confirmation where it applies.
- **Context tool `context_get`.** In a single call it returns:
  - the books owner's name and today's date in the business time zone;
  - accounts, expense categories (with type) and taxes;
  - active employees;
  - which months are closed.

  This lets the agent use real ids instead of guessing them.

### Tools

| Domain | Read | Write |
|---|---|---|
| Context | `context_get` | — |
| Expenses | `expenses_list` (exists), `expense_get` | `expense_create` (exists), `expense_update`, `expense_pay`, `expense_delete`, `expenses_create_bulk` |
| Incomes | `incomes_list`, `income_get` | `income_create`, `income_update`, `income_delete`, `incomes_create_bulk` |
| Payables | `payables_list`, `payable_get` | `payable_create`, `payable_update`, `payable_add_payment`, `payable_delete`, `payable_payment_delete` |
| Receivables | `receivables_list`, `receivable_get` | `receivable_create`, `receivable_update`, `receivable_add_collection`, `receivable_delete`, `receivable_collection_delete` |
| Recurring expenses | `recurring_expenses_list` | `recurring_expense_create`, `recurring_expense_update`, `recurring_expense_delete` |
| Tax payments | `tax_payments_list`, `tax_payment_estimate` | `tax_payment_create`, `tax_payment_update`, `tax_payment_pay`, `tax_payment_delete` |
| Payroll | `payroll_list` (exists) | `payroll_create` (exists), `payroll_pay` (exists), `payroll_generate`, `payroll_update`, `payroll_delete` |
| Employees | `employees_list` | `employee_create`, `employee_update`, `employee_delete` |
| Fixed assets | `fixed_assets_list` | `fixed_asset_create`, `fixed_asset_update`, `fixed_asset_dispose`, `fixed_asset_delete` |
| Product costs | `product_costs_list`, `product_costs_missing` | `product_cost_create`, `product_cost_update`, `product_cost_delete`, `product_costs_bulk` |
| Cost of goods sold | `cogs_list` (by income) | `cogs_create`, `cogs_update`, `cogs_delete` |
| Accounts | `accounts_list` | `account_create`, `account_update`, `account_delete` |
| Categories | `expense_categories_list` | `expense_category_create`, `expense_category_update`, `expense_category_delete` |
| Tax catalog | `taxes_list` | `tax_create`, `tax_update`, `tax_delete` |
| Reports | `income_statement`, `sales_daily`, `sales_by_employee` (exist), `monthly_report`, `expenses_breakdown`, `cash_report`, `inventory_valuation`, `sales_without_cost`, `monthly_close_status` | — |

### What stays off limits (structural denylist)

There is no code path to these, whatever permissions the role has:
- users, roles and permissions;
- invitations;
- MCP keys;
- the Shopify connection and its credentials, including OAuth, reconnection and recalculating costs;
- closing, reviewing or reopening a month (`monthly_close_status` only reads);
- authentication.

### Policy change

`src/mcp/CLAUDE.md` and the `mcp-server` spec stop saying "writes only in domains with an explicit policy (expenses and payroll)". The new rule is: **every domain except the denylist, with the write policy of this change**. Tax payments, payroll taxes included, leave the denylist.

## Capabilities

### Modified Capabilities
- `mcp-server`: the registry grows from 8 to about 80 tools, the write policy becomes the general one with the infrastructure above, and the denylist shrinks to administration and credentials.

### New Capabilities
- `mcp-action-log`: a log of what the agent did, with before and after states, the basis for idempotency and for "delete only what it created".

## Non-goals

- **Attaching receipt images.** The schema has nowhere to store files; that is a separate change.
- **Undoing from the app.** `mcp_actions` keeps what would be needed, but the "undo" screen is a later change. This one exposes the log by API (`GET /mcp-actions`).
- **A natural-language agent inside Paldex.** This exposes tools; the agent lives in the MCP client (Claude, etc.).
- **Generic CRUD tools** (one tool that takes the entity as a parameter). See `design.md`, decision 1.

## Impact

- **Schema:** the `mcp_actions` table (additive migration).
- **Code:**
  - `src/mcp/` is reorganized into `tools/<domain>.tools.ts` with a shared `McpToolkit` (authorization, DTO validation, log, idempotency, warnings, confirmation);
  - `McpModule` imports the services of every exposed domain;
  - `GET /mcp-actions` (permission `mcp_action:read`).
- **Permissions:** the `ai_agent` role needs the matching permissions, set by hand or with the script in task 8.1. No new permission is invented except `mcp_action:read`.
- **Tests:** the registry test lists every tool and every write tool, as it does today, and adds the denylist.
- **Breaking:** none for REST. Existing tools keep their names and arguments. Their response gains `warnings` and `action_id`, wrapped in `{ entity, … }` only for writes.
