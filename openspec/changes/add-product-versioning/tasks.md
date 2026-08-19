## 1. Changelog y número de versión

- [x] 1.1 Crear `CHANGELOG.md` en la raíz de `paldex-api` con el encabezado del formato Keep a Changelog y una primera entrada `## [1.0.0] - <fecha del release>` que resuma en español, orientado al usuario, lo que el producto ya hace (ingresos y gastos, nómina, impuestos, cuentas por pagar y cobrar, cierre mensual, integración con Shopify, reportes y avalúo de inventario).
- [x] 1.2 Fijar `"version": "1.0.0"` en `package.json` y documentar en un comentario del changelog el criterio de semver acordado (PATCH: correcciones visibles; MINOR: pantallas, reportes o campos nuevos; MAJOR: algo que el usuario debe volver a aprender).
- [x] 1.3 Escribir la prueba de consistencia (`src/version/version-consistency.spec.ts`) que lea ambos archivos y falle nombrando los dos valores cuando la entrada más reciente del changelog no coincida con `package.json`.

## 2. Parser del changelog

- [x] 2.1 Crear `src/version/changelog.parser.ts`: recibe el contenido del archivo y devuelve las entradas ordenadas de más reciente a más antigua, cada una con `version`, `released_at` y los cambios agrupados en `added`, `changed`, `fixed`, `removed`.
- [x] 2.2 Omitir —sin lanzar— las entradas cuyo encabezado no cumpla `## [x.y.z] - YYYY-MM-DD`, devolviendo junto al resultado la lista de encabezados descartados para que el llamador pueda registrarlos.
- [x] 2.3 Pruebas del parser: archivo con varias versiones y varias secciones, versión con una sola sección, encabezado mal formado que se omite sin arrastrar a los demás, archivo vacío, y el orden de salida (más reciente primero) aunque el archivo esté desordenado.

## 3. Servicio de versión

- [x] 3.1 Crear `src/version/version.service.ts` que en `onModuleInit` lea `CHANGELOG.md` desde `process.cwd()` —con una variable de entorno para sobrescribir la ruta en pruebas—, lo parsee una sola vez y cachee el resultado en memoria.
- [x] 3.2 Resolver la versión vigente: la entrada más reciente del changelog; `package.json` como respaldo cuando el archivo falte o no parsee. En ese caso `released_at` queda `null`.
- [x] 3.3 Registrar un `warn` explícito —nombrando la ruta buscada— cuando el archivo no exista o no parsee, y otro por cada encabezado descartado. La aplicación MUST arrancar igual en ambos casos.
- [x] 3.4 Exponer los metadatos del build: `commit` desde `process.env.APP_COMMIT`, devolviendo `null` cuando la variable esté vacía o ausente (nunca `"unknown"`), y `started_at` calculado desde `process.uptime()`.
- [x] 3.5 Pruebas del servicio: changelog ausente (arranca, versión de `package.json`, `released_at: null`, `warn` emitido), changelog válido, `APP_COMMIT` ausente → `null`, y que el archivo se lee una sola vez aunque se consulte varias.

## 4. Endpoints

- [x] 4.1 Crear las entidades de respuesta `src/version/entities/version.entity.ts` y `release.entity.ts` como clases reales —no tipos inline— para que el plugin de `@nestjs/swagger` documente el contrato solo.
- [x] 4.2 Crear `src/version/version.controller.ts` con `GET /version`, marcado `@Public()`, devolviendo `version`, `released_at`, `commit` y `started_at`.
- [x] 4.3 Añadir `GET /releases` con `@RequirePermissions()` sin argumentos (sólo exige sesión, como `/user/me`), devolviendo el historial completo, más reciente primero.
- [x] 4.4 Crear `src/version/version.module.ts` y registrarlo en `app.module.ts`.
- [x] 4.5 Añadir la versión vigente a la respuesta de `GET /health` en `src/app.controller.ts`, sin alterar su semántica de estado ni el `503` cuando MySQL no responde.
- [x] 4.6 Pruebas de los controladores: `/version` responde sin token, `/releases` responde `401` sin token y `200` con sesión válida, `/releases` devuelve `[]` con el changelog ausente, y `/health` conserva su `503`.

## 5. Build e imagen

- [x] 5.1 Añadir a la etapa `production` del `Dockerfile` el `COPY --from=builder --chown=node:node /app/CHANGELOG.md ./` — hoy la etapa final sólo copia `package*.json`, `prisma/` y `dist/`, así que sin esto el endpoint queda vacío únicamente en producción.
- [x] 5.2 Declarar `ARG SOURCE_COMMIT` en la etapa `production` y fijarlo como `ENV APP_COMMIT=$SOURCE_COMMIT`, recordando en un comentario que un `ARG` no sobrevive al build.
- [x] 5.3 Verificar con un build local (`docker build --target production --build-arg SOURCE_COMMIT=test .`) que el archivo llegó a la imagen y que `/version` devuelve el commit; y sin el build arg, que devuelve `null`.

## 6. Documentación y cierre

- [x] 6.1 Documentar en `paldex-api/CLAUDE.md` el proceso de release: entrada en el changelog dentro del mismo commit que el cambio, bump de `package.json`, criterio de semver, y que `paldex-api` es el dueño de la versión del producto.
- [x] 6.2 Anotar en `DEPLOY-COOLIFY.md` que `SOURCE_COMMIT` lo inyecta Coolify y que el orden de despliegue es API primero, app después.
- [x] 6.3 Correr la suite completa (`npm test`) y el lint, y comprobar en `/api-docs` que ambos endpoints aparecen documentados con sus entidades.
