## 1. Esquema, categorías y permisos

- [x] 1.1 Añadir a `prisma/schema.prisma` el modelo `FixedAsset` (`name`, `kind`, `asset_class`, `acquisition_cost`, `acquired_at`, `in_service_at`, `useful_life_months`, `salvage_value` default 0, `disposed_at?`, `disposal_amount?`, `expense_id?` con FK a `expenses`, `notes?`, `user_id`, `created_at`, `updated_at`) con índices por `user_id` e `in_service_at`, y los enums `FixedAssetKind` (`TANGIBLE`, `INTANGIBLE`) y `FixedAssetClass` (`COMPUTER`, `VEHICLE`, `FURNITURE`, `MACHINERY`, `LEASEHOLD_IMPROVEMENT`, `SOFTWARE`, `OTHER`). Dinero en `Decimal(14,2)`.
- [x] 1.2 Añadir `INTEREST` y `CAPEX` a `ExpenseCategoryType`, con sus marcas en `DEFAULT_FLAGS` de `expense-categories.service.ts` (ambos `affects_gross_profit: false`, `affects_operating_profit: false`, `is_cash_outflow: true`).
- [x] 1.3 En `SYSTEM_CATEGORIES`: "Intereses de deuda" pasa a `INTEREST` sin override, y se agrega "Compra de activo fijo" (`CAPEX`).
- [x] 1.4 Generar la migración con `docker exec paldex-api-1 npx prisma migrate dev --create-only` y añadirle a mano: el `UPDATE` de "Intereses de deuda" (`type = 'INTEREST'`, `affects_operating_profit = false`, sólo `is_system`) ("Compra de activo fijo" no se inserta: `DataSeedService` la siembra al arrancar para cada cuenta). Revisar que el resto sea aditivo.
- [x] 1.5 En `sumExpensesByPurpose`, sumar `INTEREST` a `operating` y tratar `CAPEX` como fuera de operación, para que `GET /reports/monthly` dé los mismos números que antes. Prueba que lo fije.
- [x] 1.6 Añadir `fixed_asset:create|read|update|delete` y sus variantes `OWN` a `PERMISSION_CATALOG`.

## 2. Depreciación

- [x] 2.1 Crear `src/fixed-assets/depreciation.ts` con funciones puras: `monthlySchedule(asset)`, `depreciationInRange(asset, start, end)`, `accumulatedAt(asset, date)`, `bookValueAt(asset, date)` y `disposalResult(asset)`, con `Decimal` y redondeo a centavos (último mes absorbe el residuo). Las fechas de mes se calculan en la zona del negocio.
- [x] 2.2 Crear `src/fixed-assets/asset-classes.ts` con la tabla clase → vida útil sugerida y `kind` (decisión 6 del diseño), con comentario que cite el art. 34 / 33 de la LISR.
- [x] 2.3 Pruebas de `depreciation.ts`: arranque el mes siguiente, residuo de redondeo, fin de vida útil, valor residual, baja a mitad de vida (se detiene y calcula ganancia/pérdida), rango parcial de mes (incluye el día 1 o no), y que sumar meses sueltos iguale el rango completo.

## 3. API de activos fijos

- [x] 3.1 Crear `src/fixed-assets/` con módulo, servicio y controlador: `POST`, `GET` (lista paginada con `book_value` y `accumulated_depreciation` a hoy o a `as_of`), `GET /:id`, `PATCH /:id`, `DELETE /:id`, y `POST /:id/dispose` (`disposed_at`, `disposal_amount`).
- [x] 3.2 DTOs con `class-validator`: costo > 0, vida ≥ 1, `salvage_value` < costo, `in_service_at` ≥ `acquired_at`, `disposed_at` ≥ `in_service_at`. Si no llega `useful_life_months`, tomarla de la clase.
- [x] 3.3 Validar `expense_id`: del dueño efectivo (si no, `404`) y en categoría `CAPEX` (si no, `400` nombrando la categoría actual). Nunca recategorizar.
- [x] 3.4 Entidad `FixedAssetEntity` con `toMoneyNumber()` en cada campo de dinero y `@ApiProperty` documentando que la depreciación es línea recta de gestión, no la fiscal exacta.
- [x] 3.5 Filtrar por dueño con `buildOwnerFilter` / `effectiveOwnerId`; pruebas de aislamiento con alcance `OWN`.
- [x] 3.6 Incluir los activos del dueño en el `source_fingerprint` de `MonthlyClose` (subir `fingerprint_version`) y probar que editar uno marca el mes cerrado como desactualizado.

## 4. Estado de resultados

- [x] 4.1 Crear `src/reports/income-statement.service.ts` que reúna en paralelo: ventas e ingresos y COGS (reutilizando las consultas de `ReportsAggregationService`), gastos pagados agrupados por categoría, nómina neta pagada, `TaxPayment` pagado agrupado por `type`, y activos del dueño.
- [x] 4.2 Clasificar cada grupo en su renglón según el diseño (decisiones 1–4 y 8) y armar `lines`, `summary` con márgenes, `cash_items`, `quality` y `warnings`.
- [x] 4.3 DTO `IncomeStatementQueryDto` (`start_date`, `end_date` obligatorios, tope 366 días) y entidad de respuesta con `@ApiProperty`.
- [x] 4.4 Exponer `GET /reports/income-statement` y `GET /reports/income-statement/export?format=csv` en `reports.controller.ts` con `@RequirePermissions('report:read')`.
- [x] 4.5 Pruebas: el escenario de cuadre de EBITDA del spec, IVA fuera, intereses abajo del EBIT, `CAPEX` sólo en flujo, `SHOPIFY_FEES` manual en costo de ventas, `PAYROLL_TAX` en nómina, `OTHER` en operación, ganancia/pérdida en baja, cuadre de "ningún gasto se pierde", márgenes nulos sin ventas, aislamiento por dueño, y que las ventas netas y el COGS coincidan con `GET /reports/monthly` para el mismo mes.

## 5. MCP

- [x] 5.1 Registrar `income_statement` en `mcp-tools.service.ts` (`report:read`, fechas obligatorias, llama al mismo servicio con el contexto de la llave).
- [x] 5.2 Actualizar el test de registro (ocho tools, mismas tres de escritura, ninguna de activos) y la tabla de `src/mcp/CLAUDE.md`.

## 6. Front (`paldex-app`)

- [x] 6.1 `FixedAssetsResource`, tipos en `ModelTypes.tsx` y ruta/entrada de menú "Activos fijos" condicionada a `fixed_asset:read`.
- [x] 6.2 Página "Activos fijos": tabla (nombre, clase, costo, en uso desde, vida útil, depreciación acumulada, valor en libros, estado), alta/edición con la vida útil sugerida por clase, acción "Dar de baja", y aviso visible de recategorizar la compra a "Compra de activo fijo".
- [x] 6.3 Página "Estado de resultados" en Reports: selector de rango con atajos (mes, trimestre, año en curso), tabla de `lines` con subtotales resaltados y márgenes, bloque de flujo aparte, avisos de `quality` y `warnings`, botón de export CSV, y nota de que la utilidad neta difiere de la del reporte mensual porque aquí el IVA no es gasto.
- [x] 6.4 Traducciones en `es.ts` y `en.ts`; pruebas de ambas páginas con el patrón de mock de `../API/Api`.

## 7. Cierre

- [x] 7.1 Documentar en `paldex-api/CLAUDE.md` la sección del estado de resultados (qué va en cada renglón y por qué, nómina = neto + `PAYROLL_TAX`, IVA fuera, `CAPEX` contra depreciación) y la de activos fijos.
- [x] 7.2 Entrada en `CHANGELOG.md` (MINOR) y `version` de `package.json`.
- [x] 7.3 `npm test` y `npm run lint` en ambos repos, `npm run build` en el front, `openspec validate add-income-statement --strict`.
- [ ] 7.4 En producción: registrar los activos existentes, recategorizar sus compras ya capturadas, y comparar el estado de resultados de un mes cerrado contra el reporte mensual (ventas y COGS iguales; diferencias sólo por IVA, intereses y depreciación).
