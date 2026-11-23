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

## [1.3.0] - 2026-11-23

### Added

- Estado de resultados con EBITDA, en Reportes, para cualquier periodo de hasta un año: ventas
  netas, costo de ventas, utilidad bruta, gastos de operación, nómina, EBITDA, depreciación,
  utilidad operativa, intereses, utilidad antes de impuestos, ISR y utilidad neta, con el margen
  de cada una. Se puede descargar en CSV y el asistente de IA también lo puede consultar.
- Lo que sale de la cuenta pero no es gasto (el IVA que se entera al SAT, las compras de equipo,
  las compras de mercancía, el pago de capital de préstamos y los retiros del dueño) aparece
  aparte, para que se vea que no se perdió nada.
- Registro de activos fijos: computadoras, mobiliario, vehículos, adaptaciones al local o
  software. Se captura cada uno una vez y Paldex reparte su costo mes a mes según su vida útil
  (propone la del SAT), en vez de restarlo completo el mes de la compra. Se puede dar de baja un
  activo vendido o roto, y la ganancia o pérdida aparece en el estado de resultados.
- Categoría de gasto "Compra de activo fijo". Si ya habías registrado la compra de un equipo como
  otro gasto, cámbiala a esta categoría al dar de alta el activo; si no, se contaría dos veces.
- En la credencial del asistente se puede elegir en los libros de qué cuenta registra lo que hace.

### Changed

- Los intereses de préstamos tienen su propia categoría y en el estado de resultados se restan
  después de la utilidad operativa. El reporte mensual sigue mostrando los mismos números.

## [1.2.0] - 2026-08-25

### Changed

- El asistente de inteligencia artificial ya no se conecta con una contraseña, sino con una
  credencial que se puede revocar y reemplazar en cualquier momento. Una contraseña no caduca,
  no se puede cambiar sin entrar a la base de datos, y quien la tenga es el asistente para
  siempre; esto se corta con un clic y surte efecto de inmediato.
- Se pueden tener varias credenciales activas a la vez, para cambiar la del asistente sin
  dejarlo sin servicio: se emite la nueva, se cambia donde esté configurada y se revoca la
  vieja.
- Cada credencial guarda cuándo se usó por última vez, que es lo que sirve para saber si
  alguien alcanzó a usarla en caso de que se filtre. Al revocarla no se borra, justo para no
  perder ese rastro.
- Una credencial del asistente sólo sirve para consultar el negocio a través del asistente: no
  abre ninguna otra parte de Paldex, ni siquiera para emitir más credenciales.

### Added

- Nuevos permisos para decidir quién puede emitir, ver y revocar las credenciales del
  asistente. La pantalla para administrarlas llega en una versión próxima; por ahora se operan
  desde la API.

## [1.1.0] - 2026-08-25

### Added

- Ventas día por día: nuevo reporte que muestra cuánto se vendió cada día del periodo que
  elijas. Los días sin ventas aparecen en cero en vez de faltar, para no confundir «no se
  vendió nada» con «no hay dato».
- Paldex se puede conectar a un asistente de inteligencia artificial para preguntarle por el
  negocio con tus propias palabras. El asistente sólo consulta: puede ver ventas y gastos, y
  lo único que puede registrar es un gasto. Nunca alcanza la nómina, los pagos de impuestos,
  los usuarios y permisos ni las credenciales de Shopify. El acceso se le quita en cualquier
  momento desde los permisos de su rol.

### Changed

- Ventas por empleado: además de por mes, ahora se puede pedir por cualquier rango de fechas,
  y filtrar a una sola persona o a varias para compararlas. Al filtrar se sigue mostrando el
  total del periodo completo, para saber qué parte de las ventas representa lo que estás
  viendo.
- Ventas por empleado: cada renglón dice si la persona sigue activa. Un empleado dado de baja
  ya no tiene días asignados, así que aparecía en ceros como si no hubiera vendido, cuando lo
  cierto es que sus días ahora son de alguien más.

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
