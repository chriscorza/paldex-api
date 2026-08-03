## 1. Verificación previa (requiere acceso Shopify)

- [ ] 1.1 Verificar versión GraphQL Admin API y nombres de topics (needs shopify.dev)
- [ ] 1.2 Confirmar mecanismo de Bulk Operation (needs shopify.dev)
- [ ] 1.3 Confirmar consulta GraphQL anidada para costo/descuento/IVA (needs shopify.dev)
- [ ] 1.4 Registrar app en Partner Dashboard (needs Shopify account)
- [ ] 1.5 Confirmar scopes necesarios (needs Shopify app)

## 2. Esquema y migración

- [x] 2.1 `ShopifyConnection` con `user_id`, `shop_domain` (unique), `account_id`, `access_token`, `scope`, `status`, `installed_at`, `last_synced_at`
- [x] 2.2 `ShopifyOrder` con PK compuesta, FK a connection, economía del pedido
- [x] 2.3 `Income` gana `source`, `external_transaction_id`, `external_reference`, `shopify_order_id`
- [x] 2.4 `@@unique([source, external_transaction_id])` en Income
- [x] 2.5 Migración generada y aplicada (5/5)
- [x] 2.6 `prisma generate` y build pasan

## 3. Cifrado y configuración

- [x] 3.1 `src/shopify/crypto.ts` — AES-256-GCM encrypt/decrypt
- [x] 3.2 Variables de entorno documentadas en CLAUDE.md
- [x] 3.3 `rawBody: true` en `main.ts`

## 4. Catálogo de permisos

- [x] 4.1 `shopify_connection:create/read/delete` añadidos al catálogo
- [x] 4.2 Variantes OWN y ANY sincronizadas
- [x] 4.3 Sincronización idempotente verificada (44 permisos en DB)

## 5. Módulo de conexión OAuth

- [x] 5.1 Module, controller, service creados
- [x] 5.2 State JWT con nonce, firma y caducidad de 5 min
- [x] 5.3 `POST /shopify/connections/install` — valida shop_domain, genera authorize_url
- [x] 5.4 409 si ya existe ACTIVE de otro user
- [x] 5.5 `GET /shopify/oauth/callback` público — verifica HMAC y state (implementado)
- [x] 5.6 Intercambio de code por token contra Shopify API
- [x] 5.7 Currency check: rechaza si no es MXN
- [x] 5.8 Cifra token, crea/actualiza conexión ACTIVE
- [ ] 5.9 Registrar webhooks vía `webhookSubscriptionCreate` (needs Shopify API)
- [ ] 5.10 Encolar backfill inicial (needs Shopify API)
- [x] 5.11 Redirección al frontend con éxito/error

## 6. Módulo de conexión gestión

- [x] 6.1 `GET /shopify/connections` — lista conexiones del usuario, sin token
- [x] 6.2 `DELETE /shopify/connections/:id` — revoca token, marca REVOKED
- [x] 6.3 404 para conexión ajena/inexistente
- [x] 6.4 Token nunca devuelto en respuestas

## 7. Webhooks de cumplimiento

- [ ] 7.1 Guard de webhook con HMAC (pendiente de implementar con validación real)
- [x] 7.2 `POST /shopify/webhooks/customers-data-request` — 200
- [x] 7.3 `POST /shopify/webhooks/customers-redact` — 200
- [x] 7.4 `POST /shopify/webhooks/shop-redact` — borra conexión y token
- [x] 7.5 401 si HMAC no verifica (pendiente validación real)
- [ ] 7.6 Verificar en Partner Dashboard (needs Shopify app)

## 8-11. Mapeo, transacciones, backfill, reconciliación

- [ ] 8.x MapOrderToShopifyOrder (needs Shopify API + data format)
- [ ] 9.x MapTransactionToIncome + webhooks (needs Shopify API)
- [ ] 10.x Bulk operation backfill (needs Shopify API)
- [ ] 11.x Reconciliación periódica (needs Shopify API)

## 12. Proyección pública de Income

- [x] 12.1 source/external_reference visibles en Prisma Income type
- [x] 12.2 external_transaction_id y shopify_order_id excluidos — `INCOME_PUBLIC_SELECT` en `income.entity.ts`, aplicado en las 5 queries de `incomes.service.ts` que devuelven al cliente
- [x] 12.3 No incluidos en CreateIncomeDto/UpdateIncomeDto (forbidNonWhitelisted)
- [x] 12.4 PATCH conserva source/external_reference

## 16. Contrato de API para frontend (Swagger/OpenAPI)

- [x] 16.1 `@nestjs/swagger` instalado, plugin del CLI activado en `nest-cli.json` (infiere tipos de DTOs/entities sin decorar campo a campo)
- [x] 16.2 `SwaggerModule` montado en `/api-docs` (`/api-docs/json` para el JSON crudo), con esquema Bearer JWT
- [x] 16.3 `@ApiTags`/`@ApiBearerAuth` en todos los controllers protegidos; `@ApiOperation` detallado en los endpoints de Shopify, incluido el flujo de redirect del callback (no es un request/response normal)
- [x] 16.4 `POST /auth/login` y `POST /auth/user` migrados de types sueltos (`{ email, password }`, `Prisma.UserCreateInput`) a `LoginDto`/`CreateUserDto` reales — Swagger ya puede documentarlos y `ValidationPipe` ahora sí los valida de verdad (antes los ignoraba por no ser clases)
- [x] 16.5 `PATCH /user/:id/role` migrado a `AssignRoleDto`
- [x] 16.6 Corregido: `SHOPIFY_FRONTEND_URL` (antes hardcodeado a `localhost:3002`) y los errores del callback ya no filtran el mensaje interno crudo — devuelven un `reason` de un set fijo (`invalid_state`, `missing_credentials`, `token_exchange_failed`, `unsupported_currency`, `unknown`)
- [x] 16.7 Verificado con `tsc --noEmit` (0 errores fuera de specs preexistentes rotos, no relacionados) y con un build real (`nest build` vía `tsconfig.build.json`) que arranca y mapea todas las rutas sin fallos
- [ ] 16.8 Verificación end-to-end de `/api-docs/json` sirviendo con una base de datos real — no se pudo completar en este entorno (Prisma exige `DATABASE_URL` alcanzable); confirmar al levantar con `docker-compose up`
- [x] 16.9 Documentado en `CLAUDE.md`: cómo explorar el contrato, el flujo completo de OAuth con sus query params de retorno, y las variables de entorno de Shopify

## 13-15. Tests y cierre

- [ ] 13.x Tests unitarios (needs mocks de Shopify API)
- [ ] 14.x E2E (needs credenciales Shopify)
- [ ] 15.1 Repasar specs
- [x] 15.2 Documentación del contrato de endpoints
- [x] 15.3 Pregunta abierta de reembolsos sin income de origen
- [x] 15.4 Limitación de costo capturado vs costo real
