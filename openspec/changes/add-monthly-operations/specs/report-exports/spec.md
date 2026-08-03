## ADDED Requirements

### Requirement: Exportación del estado mensual

El sistema SHALL exponer `GET /reports/monthly/export?year&month&format`, protegido por `report:read`, con `format` en `csv` o `pdf`.

La respuesta SHALL incluir las cabeceras `Content-Type` y `Content-Disposition` con un nombre de archivo que contenga el periodo, por ejemplo `estado-mensual-2026-07.csv`.

El contenido SHALL contener exactamente los mismos renglones y las mismas cifras que `GET /reports/monthly` del mismo periodo, incluida la declaración de si proviene de un snapshot cerrado.

Un `format` no soportado MUST responder `400 Bad Request` enumerando los formatos válidos.

#### Scenario: Exportar a CSV

- **WHEN** se pide `GET /reports/monthly/export?year=2026&month=7&format=csv`
- **THEN** la respuesta es un CSV descargable con los renglones del estado mensual y `Content-Disposition` con el nombre del archivo

#### Scenario: Coherencia con el reporte

- **WHEN** se comparan las cifras del CSV con las de `GET /reports/monthly` del mismo periodo
- **THEN** coinciden exactamente, renglón por renglón

#### Scenario: Formato no soportado

- **WHEN** se pide `format=xlsx`
- **THEN** el sistema responde `400 Bad Request` indicando que los formatos válidos son `csv` y `pdf`

#### Scenario: Mes cerrado exportado

- **WHEN** se exporta un mes cerrado
- **THEN** el archivo incluye la fecha de cierre y la indicación de que las cifras provienen de un snapshot

### Requirement: Exportación de movimientos para el contador

El sistema SHALL exponer `GET /expenses/export?format=csv` y `GET /incomes/export?format=csv`, que aceptan los mismos filtros que sus listados correspondientes.

La exportación de gastos SHALL incluir todos los campos fiscales: `invoice_status`, `invoice_uuid`, `supplier_rfc`, `vendor`, `subtotal`, `tax_amount`, `withholding_amount`, `is_tax_deductible`, `tax_creditable_amount`, además de categoría, tipo financiero, estado de pago y fecha real de pago.

La exportación MUST NOT paginar: exporta el conjunto completo que los filtros producen, ignorando `page` y `limit`.

Para evitar exportaciones ilimitadas, el sistema MUST exigir un rango de fechas y MUST rechazar con `400 Bad Request` un rango mayor a 24 meses.

#### Scenario: Exportar los gastos de un mes

- **WHEN** se pide `GET /expenses/export?format=csv&start_date=2026-07-01&end_date=2026-07-31`
- **THEN** la respuesta es un CSV con todos los gastos del periodo y todas sus columnas fiscales

#### Scenario: Los filtros se respetan

- **WHEN** se pide `GET /expenses/export?format=csv&start_date=2026-07-01&end_date=2026-07-31&category_type=PAYROLL`
- **THEN** el CSV contiene sólo los gastos de tipo `PAYROLL` del periodo

#### Scenario: La paginación se ignora

- **WHEN** se pide la exportación con `page=1&limit=10` sobre un periodo con 300 gastos
- **THEN** el CSV contiene los 300 gastos

#### Scenario: Rango de fechas ausente

- **WHEN** se pide `GET /expenses/export?format=csv` sin fechas
- **THEN** el sistema responde `400 Bad Request` exigiendo un rango

#### Scenario: Rango excesivo

- **WHEN** se pide una exportación de un rango de 5 años
- **THEN** el sistema responde `400 Bad Request` indicando el máximo de 24 meses

### Requirement: CSV legible en Excel en español

El CSV generado SHALL estar codificado en **UTF-8 con BOM**, para que Excel muestre correctamente los acentos y la ñ sin que nadie tenga que reimportar el archivo.

El separador SHALL ser configurable con el parámetro `delimiter`, aceptando `,` y `;`, con **`,`** por defecto.

Los valores que contengan el separador, comillas dobles o saltos de línea MUST escaparse entre comillas dobles, duplicando las comillas internas.

Los montos SHALL escribirse con punto decimal y dos decimales, sin separador de miles y sin símbolo de moneda. Las fechas SHALL escribirse en formato ISO `YYYY-MM-DD`.

Un valor nulo SHALL escribirse como celda vacía, no como la cadena `null`.

#### Scenario: Acentos correctos en Excel

- **WHEN** se exporta un gasto con concepto `Compra de mercancía`
- **THEN** el archivo empieza con el BOM de UTF-8 y Excel en español muestra el concepto sin caracteres corruptos

#### Scenario: Concepto con coma

- **WHEN** un gasto tiene el concepto `Renta local, agosto`
- **THEN** la celda se escribe como `"Renta local, agosto"`

#### Scenario: Concepto con comillas

- **WHEN** un gasto tiene el concepto `Pedido "urgente"`
- **THEN** la celda se escribe como `"Pedido ""urgente"""`

#### Scenario: Separador punto y coma

- **WHEN** se pide `delimiter=;`
- **THEN** el CSV usa `;` como separador de columnas

#### Scenario: Campos nulos

- **WHEN** un gasto no tiene `invoice_uuid`
- **THEN** su celda queda vacía, no contiene la palabra `null`

#### Scenario: Formato de montos y fechas

- **WHEN** se exporta un gasto de `8000` pagado el 5 de agosto de 2026
- **THEN** el CSV contiene `8000.00` y `2026-08-05`, sin símbolo de moneda ni separador de miles

### Requirement: PDF del estado mensual, o CSV con la limitación declarada

`GET /reports/monthly/export?format=pdf` SHALL devolver un PDF del estado mensual generado en el servidor, con una plantilla mínima: encabezado con el periodo, los renglones del estado de resultados, los márgenes y la fecha de generación.

El sistema MUST NOT introducir un navegador headless ni un motor de renderizado pesado como dependencia sólo para este reporte. Si no existe una biblioteca ligera viable, el endpoint MUST responder `501 Not Implemented` con un mensaje que indique que el formato CSV está disponible, y la limitación MUST quedar documentada.

#### Scenario: PDF disponible

- **WHEN** se pide `format=pdf` y la generación está implementada
- **THEN** la respuesta es un PDF descargable con los renglones del estado mensual y su periodo en el encabezado

#### Scenario: PDF no implementado

- **WHEN** la generación de PDF no está disponible
- **THEN** el sistema responde `501 Not Implemented` indicando que `format=csv` sí está disponible, en lugar de devolver un archivo vacío o corrupto

### Requirement: Exportaciones bajo permiso y alcance

Todos los endpoints de exportación SHALL exigir JWT válido. Las de reportes SHALL exigir `report:read`; las de movimientos SHALL exigir el permiso de lectura de su recurso (`expense:read`, `income:read`).

Bajo alcance `OWN`, una exportación MUST contener únicamente los datos del usuario autenticado.

#### Scenario: Exportación sin permiso

- **WHEN** un usuario sin `expense:read` pide `GET /expenses/export?format=csv&start_date=2026-07-01&end_date=2026-07-31`
- **THEN** el sistema responde `403 Forbidden`

#### Scenario: Alcance propio

- **WHEN** un usuario con alcance `OWN` exporta sus gastos y existen gastos de otros usuarios en el mismo periodo
- **THEN** el CSV contiene únicamente los suyos
