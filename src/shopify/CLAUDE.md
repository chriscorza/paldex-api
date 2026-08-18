# Shopify module notes

## Shopify OAuth flow (not a normal request/response — read this before wiring the frontend)

1. Frontend calls `POST /shopify/connections/install` (normal `fetch`, JWT in `Authorization`) → gets `{ authorize_url }`.
2. Frontend does a **full page navigation** to `authorize_url` (`window.location.href = ...`, not `fetch`). The user approves access inside Shopify.
3. Shopify redirects the browser straight to `GET /shopify/oauth/callback` on **this API** — the frontend never calls this endpoint itself.
4. This API redirects the browser again, this time to `SHOPIFY_FRONTEND_URL` (env var, defaults to `http://localhost:3002` in dev), with:
   - Success: `?shopify=success&shop=<domain>`
   - Error: `?shopify=error&reason=<code>` — `reason` is one of `invalid_state`, `missing_credentials`, `token_exchange_failed`, `unsupported_currency`, `unknown`
5. The frontend needs a route that reads these query params on load and shows success/error accordingly.

Only stores billing in **MXN** are accepted — `unsupported_currency` is the expected error for anything else.

## Shopify env vars

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES` (`read_orders,read_inventory`),
`SHOPIFY_CALLBACK_URL` (must match the Partner Dashboard redirect URI, points at this API),
`SHOPIFY_FRONTEND_URL` (where the OAuth callback sends the browser back to),
`SHOPIFY_TOKEN_ENCRYPTION_KEY` (32 bytes, hex-encoded — `openssl rand -hex 32`).

## Inventory levels (`read_inventory`)

`ShopifyInventorySyncService` reads stock with a paginated `productVariants` query
(`inventoryItem { tracked unitCost inventoryLevels { ... quantities(names: ["on_hand"]) } }`),
not a Bulk Operation — a few hundred variants finish in seconds, and bulk ops cost minutes of
polling. `productVariants` is kept at the root (not `products { variants { ... } }`) so the
connection nesting stays at two levels, which is what would allow moving it to a bulk operation
later without changing the data model.

- **The granted scope is what counts**, not `SHOPIFY_SCOPES`. A connection installed before
  `read_inventory` was in the list is still alive without it, so the service checks
  `ShopifyConnection.scope` and fails asking for a reinstall. Without that check the failure
  arrives as a contextless GraphQL authorization error at 6:15am inside a cron.
- **GIDs are converted to legacy numeric ids** before being stored, like everywhere else in the
  module — see `legacyId`.

The rest of the inventory rules (why `on_hand`, why snapshots, cost precedence) are in
`paldex-api/CLAUDE.md` under "Inventory valuation".
