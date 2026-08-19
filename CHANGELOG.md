# Changelog

Todos los cambios notables de Paldex se anotan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
versionado es [semántico](https://semver.org/lang/es/), con este criterio:

- **PATCH** (`1.0.1`) — correcciones que el usuario nota, sin funcionalidad nueva.
- **MINOR** (`1.1.0`) — pantallas, reportes o campos nuevos.
- **MAJOR** (`2.0.0`) — algo que el usuario tiene que volver a aprender o rehacer.

Las notas se escriben **para quien usa Paldex**, no para quien lo programa: describen
qué puede hacer ahora el negocio, no qué archivo se tocó. Los encabezados de sección
(`Added`, `Changed`, `Fixed`, `Removed`) se quedan en inglés porque son claves del
formato; la aplicación los traduce al mostrarlos.

Este archivo es la **fuente de verdad de la versión del producto**: la entrada más
reciente es la versión vigente, y `package.json` debe coincidir con ella. Hay una
prueba que falla si se separan.

## [1.0.0] - 2026-08-18

Primera versión publicada. Resume lo que Paldex ya hace tras varios meses de trabajo.

### Added

- Registro de ingresos y gastos con cuentas, categorías, impuestos por operación y control de facturación.
- Impuestos: cálculo de IVA e ISR del periodo, estimación del pago y registro de los pagos hechos.
- Nómina: empleados, periodos de pago generados solos y registro de lo pagado.
- Gastos recurrentes que se generan solos cada periodo, sin capturarlos a mano.
- Cuentas por pagar y por cobrar, con sus abonos y su antigüedad.
- Cierre mensual: revisión del mes con lo que falta por capturar antes de darlo por cerrado.
- Conexión con Shopify: los pedidos entran solos como ingresos, con su costo de venta y la conciliación de lo depositado por cada forma de pago.
- Catálogo de costos por producto, con importación masiva y detección de ventas sin costo capturado.
- Reportes: estado mensual de resultados, tendencias, ventas por empleado, costo del inventario vendido y valor del inventario en existencia, medido al costo y a precio de lista.
- Usuarios con roles y permisos configurables, invitaciones por correo e inicio de sesión con Google.
