## 1. Schema

- [x] 1.1 Add the `McpApiKey` model to `prisma/schema.prisma`: `id`, `user_id` (relation to
      `User`), `name`, `token_prefix` (unique, indexed), `token_hash`, `last_used_at`,
      `expires_at`, `revoked_at`, `created_at`, `created_by`; `@@map("mcp_api_keys")`
- [x] 1.2 Add the reverse relation on `User` (`mcpApiKeys McpApiKey[]`)
- [x] 1.3 Generate the migration with `docker exec paldex-api-1 npx prisma migrate dev
      --create-only`, review the SQL, then apply it

## 2. Key minting and verification

- [x] 2.1 Add `src/mcp-keys/mcp-keys.service.ts` with token generation: 8-char prefix + 32 random
      bytes (`crypto.randomBytes`, base64url), returning the full `pldx_<prefix>_<secret>` once
- [x] 2.2 Implement verification: look the key up by indexed prefix, compare the SHA-256 hash with
      `crypto.timingSafeEqual`, reject when `revoked_at` is set or `expires_at` has passed —
      include the comment explaining why SHA-256 and not bcrypt (design.md decision #1)
- [x] 2.3 Implement throttled `last_used_at` (update only if older than 5 minutes, fire-and-forget
      so a failed update never fails the request)
- [x] 2.4 Unit test the service: valid key, wrong secret with a right prefix, unknown prefix,
      revoked, expired, and that the hash is never returned

## 3. Auth integration (the risky part — fail closed)

- [x] 3.1 Add the `@AllowApiKey()` decorator and its metadata key in `src/globalConstants.ts`,
      alongside `IS_PUBLIC_KEY` / `PERMISSIONS_KEY`
- [x] 3.2 Extend `AuthGuard`: when the bearer token starts with `pldx_`, require the route to
      carry `@AllowApiKey()` **before** looking the key up; throw `UnauthorizedException` if not,
      never falling through to JWT verification
- [x] 3.3 On a valid key, set `request.user = { id, email }` — the same shape the JWT path sets, so
      `PermissionsGuard`, `McpAuthorizationService` and `CurrentUser` need no changes
- [x] 3.4 Apply `@AllowApiKey()` to `POST /mcp` and nowhere else
- [x] 3.5 Test `AuthGuard` for: valid key on an opted-in route (allowed), valid key on a route
      without the decorator (401), malformed key, JWT still working unchanged, and no token (401)

## 4. Management endpoints

- [x] 4.1 Add `mcp_key:create`, `mcp_key:read`, `mcp_key:delete` to `PERMISSION_CATALOG`
- [x] 4.2 `POST /mcp-keys` — mint a key for a given `user_id` with a name and optional
      `expires_at`; returns the full token once (`mcp_key:create`)
- [x] 4.3 `GET /mcp-keys` — list keys with prefix, name and timestamps, never the secret or hash
      (`mcp_key:read`)
- [x] 4.4 `DELETE /mcp-keys/:id` — soft revoke, setting `revoked_at` and keeping the row
      (`mcp_key:delete`)
- [x] 4.5 Entity projection test asserting `token_hash` cannot appear in any response

## 5. Verification (live, against the local dev stack)

- [x] 5.1 Mint a key for the existing `ai_agent` service account; confirm the full token appears
      once and the listing shows only the prefix
- [x] 5.2 Call `POST /mcp` with the key: `tools/list` and both tools behave exactly as with a JWT
- [x] 5.3 Confirm the same key is rejected with `401` on `GET /expenses`, `GET /payroll` and
      `POST /roles`
- [x] 5.4 Revoke the key and confirm the next `POST /mcp` request fails with `401`
- [x] 5.5 Rotation: mint a second key, confirm both work, revoke the first, confirm only the second
      still works
- [x] 5.6 Confirm the role layer still bounds the key: strip the `ai_agent` role's permissions and
      confirm tool calls fail with a permission error while the key itself stays valid
- [x] 5.7 Clear the service account's password (`password: null`) and confirm `POST /auth/login`
      for it now fails while the API key keeps working

## 6. Docs

- [x] 6.1 Rewrite the auth section of `src/mcp/CLAUDE.md`: API key is the credential, remove the
      "log in as the service account" instruction so nobody follows it later
- [x] 6.2 Document both revocation paths (key vs role permissions) and the fact that revoking an
      *invitation* does NOT kill a live JWT — the non-obvious gap that motivated this change
- [x] 6.3 Note in `paldex-api/CLAUDE.md` that API keys exist and work only on `@AllowApiKey()`
      routes, so nobody assumes they authenticate the whole API
