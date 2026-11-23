# Fixed Assets

## Purpose

Llevar el registro de los activos fijos e intangibles del negocio (equipo de cómputo, mobiliario, vehículos, adaptaciones al local, software) para repartir su costo a lo largo de su vida útil como depreciación o amortización mensual, en vez de restarlo completo el mes de la compra.

## ADDED Requirements

### Requirement: Registro de activos

El sistema SHALL permitir crear, listar, consultar, editar y borrar activos fijos (`FixedAsset`) en `/fixed-assets`. Cada activo SHALL guardar nombre, `kind` (`TANGIBLE` o `INTANGIBLE`), clase (`FixedAssetClass`), costo de adquisición, fecha de compra, fecha de entrada en uso (`in_service_at`), vida útil en meses, valor residual (por omisión `0`), y opcionalmente el gasto con que se pagó (`expense_id`) y notas.

Las rutas SHALL exigir `fixed_asset:create`, `fixed_asset:read`, `fixed_asset:update` o `fixed_asset:delete`, con variante `OWN` que limite a los activos del dueño efectivo.

#### Scenario: Alta de un activo

- **WHEN** el dueño registra una laptop de 30,000 con clase `COMPUTER`, en uso desde el 10 de marzo
- **THEN** el activo se guarda con `useful_life_months = 40` propuesto por la clase y `salvage_value = 0`

#### Scenario: Vida útil distinta a la sugerida

- **WHEN** el dueño registra un activo indicando `useful_life_months = 24`
- **THEN** se guarda 24, no el valor de la clase

#### Scenario: Validaciones

- **WHEN** se intenta guardar un activo con costo menor o igual a cero, vida útil menor a 1 mes, valor residual mayor o igual al costo, o `in_service_at` anterior a la fecha de compra
- **THEN** el API responde `400` indicando el campo

#### Scenario: Aislamiento por dueño

- **WHEN** un usuario con `fixed_asset:read` en alcance `OWN` lista activos
- **THEN** sólo ve los suyos

### Requirement: Vínculo con el gasto de compra

Si se indica `expense_id`, el gasto SHALL pertenecer al dueño efectivo y su categoría SHALL ser de tipo `CAPEX`. El sistema MUST NOT recategorizar el gasto por su cuenta.

#### Scenario: Gasto en otra categoría

- **WHEN** se crea un activo con `expense_id` de un gasto en la categoría "Reinversión"
- **THEN** el API responde `400` nombrando la categoría actual y pidiendo pasarlo a "Compra de activo fijo", y el activo no se crea

#### Scenario: Gasto de otro dueño

- **WHEN** el `expense_id` pertenece a otro dueño
- **THEN** el API responde `404`

### Requirement: Depreciación mensual en línea recta

La depreciación (o amortización, si `kind = INTANGIBLE`) SHALL calcularse en línea recta: (`acquisition_cost` − `salvage_value`) ÷ `useful_life_months` por mes, redondeada a centavos, con el último mes absorbiendo el residuo para que la suma sea exactamente la base depreciable. Empieza el mes siguiente a `in_service_at` y termina al agotar la vida útil o en el mes de baja (sin incluirlo), lo que ocurra primero.

La depreciación SHALL calcularse al consultarla a partir del activo; MUST NOT guardarse como filas mensuales.

#### Scenario: Primer mes

- **WHEN** un activo de 12,000 con vida de 12 meses entra en uso el 10 de marzo
- **THEN** marzo tiene depreciación 0 y abril tiene 1,000

#### Scenario: Residuo de redondeo

- **WHEN** un activo de 10,000 con vida de 3 meses se deprecia completo
- **THEN** los meses valen 3,333.33, 3,333.33 y 3,333.34, y suman 10,000

#### Scenario: Fin de vida útil

- **WHEN** se consulta un mes posterior al último de la vida útil
- **THEN** la depreciación de ese activo es 0

### Requirement: Valor en libros

Cada activo SHALL exponer, a una fecha dada (por omisión hoy), su depreciación acumulada y su valor en libros (`acquisition_cost` − depreciación acumulada).

#### Scenario: Consulta de valor en libros

- **WHEN** se consulta un activo de 12,000 con vida de 12 meses, cuatro meses completos después del mes de entrada en uso
- **THEN** la depreciación acumulada es 4,000 y el valor en libros 8,000

### Requirement: Baja de un activo

El sistema SHALL permitir dar de baja un activo con `disposed_at` y `disposal_amount` (`0` si se desechó). Desde el mes de la baja el activo SHALL dejar de depreciarse, y SHALL calcularse la ganancia o pérdida como `disposal_amount` − valor en libros al inicio del mes de baja.

#### Scenario: Venta de un activo

- **WHEN** un activo con valor en libros de 8,000 se vende en 5,000
- **THEN** se registra una pérdida en baja de 3,000 en el mes de la venta y no hay depreciación de ese mes en adelante

### Requirement: Cambios a activos invalidan meses cerrados

El `source_fingerprint` de `MonthlyClose` SHALL incluir los activos del dueño (identificador, costo, fechas, vida útil, residual y datos de baja), de modo que editar un activo marque como desactualizado un mes cerrado igual que editar un gasto.

#### Scenario: Edición de vida útil

- **WHEN** se cambia la vida útil de un activo que se deprecia en un mes ya cerrado
- **THEN** el fingerprint de ese mes cambia y el cierre lo reporta como desactualizado
