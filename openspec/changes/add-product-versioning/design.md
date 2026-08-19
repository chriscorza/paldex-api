## Context

Paldex vive en dos repositorios y se despliega como dos aplicaciones independientes en Coolify: un push a `paldex-api` reconstruye la API, uno a `paldex-app` reconstruye el frontend. No hay ningún artefacto compartido entre ambos —ni siquiera un `package.json` raíz— así que cualquier idea de "versión del producto" tiene que vivir en uno de los dos y ser publicada por HTTP para que el otro la conozca.

Hoy `paldex-api/package.json` dice `0.0.1` y `paldex-app/package.json` dice `0.0.0`. Ninguno de los dos números ha significado nunca nada, y el producto lleva meses en manos de un negocio real.

La API ya tiene el lugar natural para exponer esto: `AppController` sirve `/health` como endpoint público, sin sesión, y Coolify lo usa como healthcheck.

## Goals / Non-Goals

**Goals:**

- Una versión semántica única que identifique al producto entero y que un usuario pueda leer en pantalla.
- Un historial de cambios legible por el dueño de la tienda, no por el que programa.
- Poder saber, mirando la aplicación corriendo, de qué commit salió cada mitad — para que un despliegue a medias sea visible en vez de fantasmal.
- Que nada de esto pueda tumbar el arranque de la API.

**Non-Goals:**

- Automatizar el bump de versión o generar el changelog desde los commits. Se descartó a conciencia (ver Decisiones).
- Versionar el contrato de la API (`/v1/`, `/v2/`). Es otro problema, con otro ciclo de vida, y hoy no hay clientes externos que lo justifiquen.
- Guardar el historial de despliegues en base de datos. Coolify ya lo tiene.
- Traducir el changelog. Se escribe en español, que es el idioma del negocio.

## Decisions

### El changelog es un archivo Markdown en `paldex-api`, no una tabla ni un JSON

`CHANGELOG.md` en la raíz del repo, formato Keep a Changelog: `## [1.4.0] - 2026-08-18` y debajo secciones `### Added` / `### Changed` / `### Fixed` / `### Removed` con viñetas.

- *Frente a una tabla en MySQL*: una tabla exige un CRUD, permisos y una migración para publicar una nota de versión, y desacopla el texto del commit que lo provocó. En un archivo, la nota entra en el mismo PR que el cambio que describe y se revisa junto a él.
- *Frente a un JSON o un módulo TS*: el archivo lo lee un humano en GitHub sin herramientas, y Keep a Changelog es un formato que ya conoce cualquiera que llegue al repo.
- *Vive en `paldex-api` y no en `paldex-app`* porque la API es quien puede servirlo por HTTP. Al revés obligaría a reconstruir el frontend para publicar una nota sobre un cambio de backend.

Los encabezados de sección se quedan en inglés (`Added`, `Changed`…) porque son claves del formato, no texto para el usuario: el JSON los expone como `added`/`changed`/… y el frontend pinta la etiqueta traducida desde sus archivos de idioma. Las viñetas sí van en español.

### Curado a mano, no generado desde los commits

Se evaluó `release-please` / conventional commits. Genera versión y changelog gratis, pero produce exactamente lo que hay en el historial de este repo: *"Show the retail value on the snapshot itself"*, *"Stop asking Shopify for a location name we cannot read"*. Son buenos mensajes de commit —dicen qué y por qué— y son completamente inútiles para quien vende ropa y quiere saber si ya puede ver cuánto vale su inventario.

El costo es real y recurrente: cada cambio perceptible exige una línea escrita a mano. Se acepta porque un changelog que nadie entiende no se lee, y un changelog que no se lee no justifica ninguna de las dos pantallas que lo consumen.

### La versión sale del changelog; `package.json` es el respaldo

La entrada más reciente del archivo manda. `package.json` se mantiene sincronizado y sirve de respuesta cuando el changelog falta o no parsea.

Que existan dos copias del mismo número es una invitación a que se separen, así que una prueba de Jest compara ambas y falla nombrándolas. Es la mitad del valor de esta decisión: sin ella, en el primer despliegue apurado la versión que ve el usuario deja de corresponder a ningún changelog, y a partir de ahí miente en silencio.

### Se parsea una vez al arrancar, en memoria

El archivo sólo cambia cuando cambia la imagen, así que releerlo por request es puro I/O sin ganancia. El parseo va en `onModuleInit` del servicio, cacheado en un campo.

Se descartó generarlo a JSON en tiempo de build (un script que emita un `.ts` dentro de `src/`): añade un paso al build, mete un archivo generado al repo o al `.gitignore`, y ahorra unos milisegundos una sola vez en la vida del proceso.

La ruta se resuelve como `process.cwd() + '/CHANGELOG.md'`, con una variable de entorno para sobrescribirla en pruebas. Funciona igual en desarrollo (`npm run start:dev` desde la raíz) y en el contenedor (`WORKDIR /app`, `node dist/main`).

### El `Dockerfile` tiene que copiar el archivo — y hoy no lo hace

La etapa `production` sólo copia `package*.json`, `prisma/` y `dist/`. Sin un `COPY --from=builder /app/CHANGELOG.md ./` el endpoint responde vacío **sólo en producción**, que es la peor forma de fallar: local funciona, el usuario no ve nada, y nada en el log grita salvo el `warn` que por eso mismo es obligatorio.

### El commit llega por `SOURCE_COMMIT`, y si falta es `null`

Coolify inyecta `SOURCE_COMMIT` como build arg. Se declara `ARG SOURCE_COMMIT` en la etapa `production` y se fija como `ENV APP_COMMIT`, porque un `ARG` no sobrevive al build.

Cuando no está —`docker build` a mano, `docker-compose` local— el campo es `null`. No `"unknown"`, no ausente: quien lo lee necesita distinguir *"no se sabe"* de un valor real, y un `"unknown"` metido en un campo de texto se acaba mostrando tal cual en pantalla.

### `released_at` es la fecha del changelog, no la del despliegue

Si se bumpea hoy y se despliega mañana, la fecha miente por un día. A cambio es estable: no cambia porque el contenedor se reinicie, que es justo lo que le pasaría a una fecha de arranque. Al usuario se le está respondiendo *"¿de cuándo es esta versión?"*, no *"¿hace cuánto reiniciaste el servidor?"*.

Para la segunda pregunta —la de operación— va aparte `started_at`, derivado de `process.uptime()`, que ya es lo que `/health` publica hoy como `uptime`.

### `/version` público, `/releases` autenticado

`/version` acompaña a `/health`: es información de operación y tiene que poder leerse con un `curl` sin token, desde un monitor o desde Coolify. Expone el commit; el repositorio es privado, así que un hash sin acceso al repo no revela nada.

`/releases` exige sesión (`@RequirePermissions()` sin argumentos, el mismo patrón de `/user/me`) pero ningún permiso concreto. Las notas de versión no son secretas, pero tampoco son un boletín público, y todo usuario con sesión debe poder verlas independientemente de su rol — atarlas a un permiso las escondería justo de quien menos permisos tiene, que es quien más necesita que le expliquen qué cambió.

### Se arranca en `1.0.0`

`0.0.1` sugiere un prototipo. Esto lleva meses llevando la contabilidad de un negocio real. La primera entrada del changelog resume en unas líneas lo que ya existe y a partir de ahí el semver cuenta de verdad, con este criterio:

- **PATCH**: correcciones que el usuario nota, sin funcionalidad nueva.
- **MINOR**: pantallas, reportes o campos nuevos.
- **MAJOR**: algo que el usuario tiene que volver a aprender o rehacer.

## Risks / Trade-offs

- **Se olvida actualizar el changelog** → La prueba de consistencia sólo detecta el desfase entre `package.json` y el archivo, no la línea que nadie escribió. Mitigación real: el proceso de release documentado en `CLAUDE.md` y que la entrada viaje en el mismo commit que el cambio.
- **La app y la API pueden mostrar versiones incoherentes** → Es precisamente lo que se quiere hacer visible, no ocultar. La pantalla "Acerca de" del frontend muestra el commit de cada mitad; que se vean distintos es la señal, no el defecto.
- **El changelog sólo existe en español** → La app es bilingüe (`src/Lang/es.ts`, `en.ts`) y las etiquetas de sección sí se traducen, pero el texto de cada cambio no. Se acepta: el usuario del producto opera en español. Si algún día deja de ser cierto, la salida es un campo por idioma en el parser, sin tocar los endpoints.
- **El archivo copiado a la imagen puede quedarse atrás** si alguien reordena el `Dockerfile` → El `warn` de arranque y el `[]` de `/releases` lo hacen detectable; conviene mirarlo en el primer despliegue.
- **Parseo tolerante** → Una entrada mal formada se omite en lugar de tumbar el arranque, lo que significa que puede desaparecer de la vista sin que nadie mire el log. Es el intercambio deliberado: se prefiere perder una nota a perder la aplicación.

## Migration Plan

1. Sin migración de base de datos, sin permisos nuevos, sin cambios de contrato existentes.
2. Se despliega primero `paldex-api` (los endpoints nuevos), después `paldex-app` (las pantallas que los consumen). En el hueco entre ambos despliegues el frontend viejo simplemente no los llama.
3. Rollback: revertir el commit. Los dos endpoints son aditivos y `/health` sólo pierde un campo que nadie consume aún.

## Open Questions

- ¿Se etiqueta también en git (`git tag v1.4.0`) además del changelog? Sería gratis y da un ancla para diffs entre versiones, pero añade un paso manual más al release.
- ¿Vale la pena que el frontend publique su propia versión en un archivo estático (`/version.json`) para poder auditarla sin abrir la app? Se decide en el cambio del repo `paldex-app`.
