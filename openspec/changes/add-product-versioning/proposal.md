## Why

Hoy nadie —ni el dueño de la tienda ni nosotros— puede responder dos preguntas básicas: *¿qué versión de Paldex estoy usando?* y *¿qué cambió desde la última vez que entré?*. El único rastro de una actualización es el historial de commits, que es privado y está escrito para desarrolladores. Peor aún: `paldex-api` y `paldex-app` se despliegan por separado en Coolify, así que es perfectamente posible quedarse con un frontend viejo hablándole a una API nueva y no tener forma de notarlo — el bug que acabamos de perseguir (permisos cacheados en el navegador) fue exactamente eso: un cliente desincronizado sin nada que lo delatara.

## What Changes

- **Una sola versión de producto**, semántica (`MAJOR.MINOR.PATCH`), que representa a Paldex entero: no una para la API y otra para la app. `paldex-api/CHANGELOG.md` es la fuente de verdad, en formato Keep a Changelog, curado a mano y **escrito para el dueño de la tienda, no para el que programa**. `version` en `package.json` refleja la entrada más reciente.
- Nuevo endpoint público `GET /version` con la versión vigente, su fecha de publicación y los metadatos de este build concreto (commit y desde cuándo lleva corriendo el contenedor).
- Nuevo endpoint autenticado `GET /releases` que devuelve el changelog ya parseado como JSON — versión, fecha y cambios agrupados por tipo (`added`, `changed`, `fixed`, `removed`) — para que el frontend pinte "Novedades" sin interpretar Markdown.
- El changelog se **parsea una sola vez al arrancar** y se cachea en memoria. Si el archivo falta o está mal formado, `/version` sigue respondiendo con lo de `package.json` y `/releases` devuelve lista vacía con un `warn` en el log: una actualización nunca debe tumbar el arranque.
- `GET /health` incluye también la versión, para poder leer en un `curl` qué hay desplegado sin abrir la app.
- El commit llega por el build arg `SOURCE_COMMIT` que Coolify ya inyecta; sin él el campo queda `null`, nunca inventado.
- Nuevo test que falla si la versión de `package.json` y la entrada más reciente de `CHANGELOG.md` no coinciden. Es la única forma barata de que las dos no se separen con el tiempo — y en cuanto se separan, la versión que ve el usuario deja de significar nada.
- Se documenta el proceso de release (bump + entrada de changelog + push) en `CLAUDE.md`.

No rompe nada: los dos endpoints son nuevos y `/health` sólo suma un campo.

## Capabilities

### New Capabilities
- `product-versioning`: la versión única de producto, su changelog como fuente de verdad curada, los endpoints que la publican y las reglas sobre qué se informa y qué no cuando falta un dato.

### Modified Capabilities
<!-- Ninguna. `/health` gana un campo aditivo pero no existe spec de health en openspec/specs/,
     así que la regla vive completa en el spec nuevo. -->

## Impact

- **Código**: `src/version/` (módulo nuevo: servicio que lee `package.json` y parsea el changelog, controlador con los dos endpoints, entidades para Swagger), `src/app.controller.ts` (el campo en `/health`), `src/app.module.ts`.
- **Build/imagen**: el `Dockerfile` debe copiar `CHANGELOG.md` a la imagen de producción — hoy la etapa final sólo copia `dist/`, así que el archivo no llegaría — y declarar `ARG SOURCE_COMMIT`.
- **Sin migración, sin permisos nuevos.** `/version` es `@Public()`; `/releases` usa `@RequirePermissions()` sin argumentos, o sea sólo exige sesión, como `/user/me`. El changelog no es información sensible pero tampoco es un boletín público.
- **Contrato**: dos endpoints más en `/api-docs`, documentados solos por el plugin de `@nestjs/swagger` siempre que las respuestas usen clases de entidad reales.
- **Frontend** (`paldex-app`): consume ambos endpoints. La pantalla "Acerca de" y el modal de novedades se especifican en el cambio `add-version-changelog-view` de ese repo.
- **Límite asumido**: `released_at` es la fecha que alguien escribió en el changelog, no la del despliegue. Si se bumpea hoy y se despliega mañana, la fecha miente por un día. A cambio, la fecha es estable entre reinicios, cosa que la del contenedor no es.
- **Proceso**: a partir de aquí, cada cambio que el usuario pueda percibir exige una línea en el changelog. Es trabajo manual recurrente y ese es el costo real de esta decisión; se eligió sobre autogenerar desde commits porque "Show the retail value on the snapshot itself" no le dice nada a quien vende ropa.
