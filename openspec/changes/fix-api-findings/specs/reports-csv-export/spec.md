## ADDED Requirements

### Requirement: Exportar reporte mensual como CSV

El sistema SHALL exponer `GET /reports/monthly/export?format=csv` que devuelve el `ProfitReport` serializado como archivo CSV con `Content-Type: text/csv` y `Content-Disposition: attachment`.

Las columnas del CSV SHALL incluir todos los campos numéricos del `ProfitReport` con sus nombres como headers. Los valores Decimal SHALL serializarse como números con 2 decimales. Los valores `null` SHALL representarse como campo vacío.

#### Scenario: Export CSV exitoso

- **WHEN** se llama `GET /reports/monthly/export?format=csv&year=2025&month=1` con un JWT válido
- **THEN** el sistema responde `200 OK` con `Content-Type: text/csv`, `Content-Disposition: attachment; filename="reporte-mensual-2025-01.csv"`, y el body contiene headers CSV seguidos de una fila con los valores del reporte

#### Scenario: Export sin format devuelve JSON

- **WHEN** se llama `GET /reports/monthly/export?year=2025&month=1` sin el parámetro `format`
- **THEN** el sistema responde `200 OK` con `Content-Type: application/json` y el `ProfitReport` en JSON (comportamiento actual sin cambios)

#### Scenario: format=pdf no soportado

- **WHEN** se llama `GET /reports/monthly/export?format=pdf`
- **THEN** el sistema responde `400 Bad Request` con un mensaje indicando que solo `csv` está soportado

#### Scenario: Campos con comas o comillas se escapan correctamente

- **WHEN** el reporte contiene un campo de texto con comas o comillas dobles
- **THEN** el valor en el CSV aparece correctamente escapado (encerrado entre comillas, comillas internas duplicadas)

#### Scenario: Export respeta el scope del usuario

- **WHEN** un usuario con scope `OWN` llama al export
- **THEN** el CSV contiene solo los datos financieros de ese usuario (mismo comportamiento que `GET /reports/monthly`)
