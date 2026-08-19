# Product Versioning

## Purpose

Dar a Paldex una versión única y visible, con un historial de cambios escrito para quien usa la aplicación, y publicar de qué build concreto viene la respuesta para poder detectar un frontend y un backend desincronizados.

## ADDED Requirements

### Requirement: Versión única de producto

Paldex SHALL tener una sola versión semántica (`MAJOR.MINOR.PATCH`) que representa al producto completo, no una por servicio desplegable.

`CHANGELOG.md` en la raíz de `paldex-api` SHALL ser la fuente de verdad de esa versión y de su historial: la entrada más reciente del archivo es la versión vigente. El campo `version` de `package.json` SHALL coincidir con ella.

El sistema SHALL fallar la suite de pruebas cuando esas dos no coincidan. Sin esa comprobación las dos se separan en el primer despliegue apurado, y una versión que no corresponde a ningún changelog es peor que no tener versión: afirma algo falso.

#### Scenario: Versión y changelog coinciden

- **WHEN** `package.json` declara `1.4.0` y la entrada más reciente de `CHANGELOG.md` es `1.4.0`
- **THEN** la prueba de consistencia pasa y `GET /version` reporta `1.4.0`

#### Scenario: Alguien bumpea sólo uno de los dos

- **WHEN** `package.json` declara `1.5.0` pero la entrada más reciente del changelog sigue siendo `1.4.0`
- **THEN** la prueba de consistencia falla nombrando ambos valores

### Requirement: Endpoint público de versión

El sistema SHALL exponer `GET /version` sin exigir autenticación, devolviendo la versión vigente, la fecha de publicación declarada en el changelog para esa versión, el commit del que se construyó la imagen y el momento en que arrancó el proceso.

`released_at` SHALL ser la fecha escrita en el changelog, no la del arranque ni la del despliegue: es la única que sobrevive a un reinicio del contenedor sin cambiar de valor.

#### Scenario: Consulta sin sesión

- **WHEN** se pide `GET /version` sin cabecera `Authorization`
- **THEN** el sistema responde `200` con la versión, su `released_at`, el commit y el `started_at` del proceso

### Requirement: Metadatos del build

El commit SHALL provenir del build arg `SOURCE_COMMIT` que Coolify inyecta al construir la imagen, fijado como variable de entorno en la imagen final.

Cuando ese dato no exista —una construcción local, un `docker build` a mano— el sistema SHALL devolver `null` en ese campo. MUST NOT devolver una cadena inventada, ni `"unknown"` disfrazado de commit, ni omitir el campo: quien lo consume necesita distinguir "no se sabe" de un valor real.

#### Scenario: Imagen construida por Coolify

- **WHEN** la imagen se construyó con `SOURCE_COMMIT=a97ef29...`
- **THEN** `GET /version` devuelve ese commit

#### Scenario: Imagen construida a mano

- **WHEN** la imagen se construyó sin `SOURCE_COMMIT`
- **THEN** `GET /version` devuelve `commit: null` y el resto de los campos con normalidad

### Requirement: Changelog servido como datos

El sistema SHALL exponer `GET /releases` a cualquier usuario autenticado, sin exigir un permiso específico, devolviendo el historial completo de versiones más reciente primero.

Cada entrada SHALL llevar la versión, su fecha y sus cambios agrupados por tipo (`added`, `changed`, `fixed`, `removed`), cada cambio como una cadena de texto ya legible. El endpoint MUST NOT devolver Markdown crudo: el cliente pinta la lista, no interpreta un formato de archivo.

El changelog SHALL parsearse una sola vez al arrancar el proceso y servirse desde memoria. Es un archivo que sólo cambia cuando cambia la imagen.

#### Scenario: Consulta autenticada

- **WHEN** un usuario con sesión válida pide `GET /releases`
- **THEN** recibe la lista de versiones, la más reciente primero, cada una con sus cambios agrupados por tipo

#### Scenario: Consulta sin sesión

- **WHEN** se pide `GET /releases` sin token
- **THEN** el sistema responde `401`

### Requirement: Un changelog roto no tumba el arranque

Cuando `CHANGELOG.md` falte o no se pueda parsear, la aplicación SHALL arrancar igual, registrar un `warn` que lo diga, responder `GET /releases` con una lista vacía y seguir reportando en `GET /version` la versión de `package.json`.

Publicar notas de versión es una función accesoria; que la contabilidad de un negocio deje de responder porque alguien escribió mal un encabezado de Markdown sería un intercambio absurdo.

#### Scenario: El archivo no llegó a la imagen

- **WHEN** el proceso arranca sin `CHANGELOG.md` en el directorio esperado
- **THEN** la aplicación arranca, deja un `warn` en el log, `GET /releases` devuelve `[]` y `GET /version` responde con la versión de `package.json` y `released_at: null`

#### Scenario: Encabezado mal formado

- **WHEN** una entrada del changelog no tiene el formato de versión y fecha esperado
- **THEN** esa entrada se omite, las demás se sirven con normalidad y queda un `warn` que la nombra

### Requirement: La versión viaja en el healthcheck

`GET /health` SHALL incluir la versión vigente junto a los campos que ya devuelve, sin cambiar su semántica de estado ni su código de respuesta.

#### Scenario: Healthcheck con base de datos viva

- **WHEN** se pide `GET /health` y MySQL responde
- **THEN** la respuesta es `200` e incluye `status`, `database`, `uptime`, `timestamp` y la versión

#### Scenario: Healthcheck con base de datos caída

- **WHEN** se pide `GET /health` y MySQL no responde
- **THEN** la respuesta sigue siendo `503`, sin que la versión altere ese comportamiento
