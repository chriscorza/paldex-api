## ADDED Requirements

### Requirement: Comparación de periodos

El sistema SHALL exponer `GET /reports/compare?periods=2026-05,2026-06,2026-07`, protegido por `report:read`.

`periods` SHALL aceptar entre 2 y 12 periodos en formato `YYYY-MM`, separados por coma. Menos de 2 o más de 12 MUST responder `400 Bad Request`, igual que un formato inválido o un periodo duplicado.

La respuesta SHALL alinear los mismos renglones del estado mensual —`net_sales`, `cogs`, `gross_profit`, `operating_expenses`, `payroll_total`, `operating_profit`, `taxes_paid`, `net_profit` y sus márgenes— uno por periodo, e incluir la variación absoluta y porcentual **entre periodos consecutivos**.

Las fórmulas MUST ser exactamente las de la capacidad `financial-reports`: este endpoint alinea cifras, no las define de nuevo.

#### Scenario: Comparación de tres meses

- **WHEN** se pide `GET /reports/compare?periods=2026-05,2026-06,2026-07`
- **THEN** la respuesta devuelve los tres periodos en orden cronológico, con cada renglón alineado y la variación de junio contra mayo y de julio contra junio

#### Scenario: Variación con periodo anterior en cero

- **WHEN** un renglón vale `0` en el periodo anterior y `5000` en el actual
- **THEN** la variación absoluta es `5000` y la porcentual es `null`, no infinito

#### Scenario: Un solo periodo

- **WHEN** se pide `GET /reports/compare?periods=2026-07`
- **THEN** el sistema responde `400 Bad Request` indicando que hacen falta al menos dos periodos

#### Scenario: Formato inválido

- **WHEN** se pide `periods=julio-2026`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Periodo duplicado

- **WHEN** se pide `periods=2026-07,2026-07`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Periodo sin datos

- **WHEN** uno de los periodos comparados no tiene ningún movimiento
- **THEN** su columna devuelve ceros con márgenes `null`, y la comparación se produce normalmente

### Requirement: Cada cifra declara su procedencia

Cada periodo de la respuesta SHALL declarar `source: 'SNAPSHOT' | 'DYNAMIC'` y, cuando sea snapshot, su `closed_at`.

Comparar un mes cerrado con uno abierto SHALL permitirse. Lo que MUST NOT ocurrir es que el consumidor no pueda distinguirlos: un mes abierto puede cambiar mañana y un mes cerrado no.

#### Scenario: Mezcla de cerrado y abierto

- **WHEN** se comparan mayo y junio cerrados con julio abierto
- **THEN** las dos primeras columnas declaran `source: 'SNAPSHOT'` con su fecha de cierre, y la tercera `source: 'DYNAMIC'`

#### Scenario: Aviso de comparación mixta

- **WHEN** la comparación mezcla periodos cerrados y abiertos
- **THEN** la respuesta incluye una bandera `has_mixed_sources: true`

### Requirement: Serie de tendencia

El sistema SHALL exponer `GET /reports/trends?months=12`, que devuelve una serie mensual con `net_sales`, `gross_profit`, `operating_profit`, `net_profit`, `gross_margin_percentage`, `net_margin_percentage` y `payroll_ratio`, terminando en el mes actual.

`months` SHALL aceptar de `2` a `36`. Fuera de rango MUST responder `400 Bad Request`.

Los meses sin datos MUST aparecer en la serie con ceros y márgenes `null`, no omitirse: una serie con huecos silenciosos se grafica mal.

Cada punto SHALL declarar su `source`.

#### Scenario: Serie de doce meses

- **WHEN** se pide `GET /reports/trends?months=12`
- **THEN** la respuesta contiene doce puntos en orden cronológico, terminando en el mes actual

#### Scenario: Mes sin actividad en medio de la serie

- **WHEN** uno de los meses de la serie no tiene movimientos
- **THEN** aparece en su posición con montos en `0` y márgenes `null`

#### Scenario: Rango fuera de límite

- **WHEN** se pide `months=48`
- **THEN** el sistema responde `400 Bad Request`

#### Scenario: Serie que cruza un año

- **WHEN** se pide una serie de 12 meses en marzo de 2027
- **THEN** la serie va de abril de 2026 a marzo de 2027, con los años correctos en cada punto

### Requirement: Alcance y permiso

`GET /reports/compare` y `GET /reports/trends` SHALL exigir JWT válido y el permiso `report:read`, y bajo alcance `OWN` MUST considerar únicamente los datos del usuario autenticado.

#### Scenario: Petición sin permiso

- **WHEN** un usuario sin `report:read` pide `GET /reports/trends?months=12`
- **THEN** el sistema responde `403 Forbidden`

### Requirement: Rendimiento acotado de las series

`GET /reports/trends` con 36 meses MUST resolverse con un número de consultas proporcional al número de bloques agregados, no al número de meses: la agregación SHALL agrupar por mes en SQL, no ejecutar el reporte mensual 36 veces.

Los meses cerrados MUST leerse de su snapshot en lugar de recalcularse.

#### Scenario: Serie larga

- **WHEN** se pide `GET /reports/trends?months=36`
- **THEN** la respuesta se produce con un número acotado de consultas agrupadas por mes, no con 36 cálculos completos

#### Scenario: Serie mayormente cerrada

- **WHEN** se pide una serie de 12 meses de los cuales 11 están cerrados
- **THEN** los 11 se leen de sus snapshots y sólo el mes abierto se calcula
