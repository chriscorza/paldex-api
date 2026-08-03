## Why

`add-roles-permissions` resuelve **qué puede hacer** cada usuario, pero no **sobre qué datos**. Hoy los modelos de dominio no tienen propietario: `Account`, `Income` y `Expense` no llevan `user_id`, así que dos usuarios con el mismo rol ven exactamente las mismas cuentas y los mismos movimientos.

Esa carencia se ha ido arrastrando y quedó anotada como riesgo en los cuatro changes anteriores. La consecuencia práctica es que exigir JWT en todos los endpoints **da apariencia de aislamiento sin darlo**: cualquier usuario autenticado puede leer, editar y borrar las finanzas de cualquier otro. Es la segunda mitad del plan acordado y la que hace que el sistema de permisos signifique algo.

## What Changes

- **Columna `user_id` obligatoria** en `Account`, `Income` y `Expense`, con FK a `User`. **Requiere migración con backfill de las filas existentes.**
- **`Tax` queda fuera**: el catálogo de impuestos sigue siendo común a toda la instalación y administrado por permisos, no por propiedad. Ver la decisión 2 del `design.md`.
- **Permisos con scope `OWN`** activos por primera vez. El catálogo pasa a emitir cada permiso de recurso en sus dos variantes, `OWN` y `ANY`, y el rol `user` recibe las `OWN` mientras `admin` conserva las `ANY`.
- **Filtrado por propietario en todas las lecturas**: `GET /incomes`, `/accounts`, `/expenses` y sus `GET /:id` devuelven sólo lo del usuario, salvo que su permiso sea `ANY`.
- **Asignación automática de propietario en las escrituras**: el `user_id` sale del token, nunca del body. Un `user_id` en el cuerpo de la petición se rechaza.
- **Comprobación de propiedad en escrituras y borrados**: modificar o borrar algo ajeno responde `404`, no `403`. Ver la decisión 5.
- **Validación cruzada de referencias**: un income no puede apuntar a una cuenta de otro usuario.
- **`total` y los contadores pasan a ser por usuario**: los `incomes_count`/`expenses_count` de `GET /accounts/:id` cuentan sólo lo visible para quien pregunta.

### No incluido (non-goals)

- No se comparten datos entre usuarios: no hay espacios compartidos, ni invitaciones, ni cuentas conjuntas. Cada usuario ve lo suyo. Compartir finanzas en pareja — que el nombre `partner-chores-api` sugiere — sería un modelo distinto y bastante mayor.
- No se añade `user_id` a `Tax`.
- No se migran los `Float` monetarios a `Decimal`.
- No se resuelve la deriva de `Account.balance`.
- No se toca el hashing de contraseñas.

## Capabilities

### New Capabilities
- `data-ownership`: propiedad de los datos financieros por usuario, el filtrado de lecturas según el scope del permiso, la asignación de propietario en las escrituras y las reglas de integridad entre recursos de distinto dueño.

### Modified Capabilities
- `incomes-crud`: las lecturas dejan de devolver todos los ingresos y las escrituras pasan a exigir propiedad.
- `accounts-crud`: mismo cambio, más los contadores de `GET /accounts/:id`, que pasan a contar sólo lo del usuario.
- `expenses-crud`: mismo cambio.
- `roles-permissions`: el catálogo pasa a emitir permisos en scope `OWN` y `ANY`, y la resolución debe decidir cuál prevalece.

## Impact

**Base de datos** — **migración con backfill de datos reales**:
- `accounts.user_id`, `incomes.user_id`, `expenses.user_id`, todas `NOT NULL` con FK a `users`.
- Las filas existentes no tienen dueño. Hay que decidir a quién se le adjudican y ejecutarlo en la propia migración — es la parte más delicada de este change y la única con pérdida potencial si se hace mal.

**Código modificado**
- `prisma/schema.prisma`
- `src/permissions/permission-catalog.ts` — variantes `OWN` y `ANY`
- `src/auth/permissions.guard.ts` — resolución del scope efectivo
- `src/incomes/`, `src/accounts/`, `src/expenses/` — services y controllers
- `src/common/filters/` — el `where` compuesto pasa a incluir el filtro de propietario

**Dependencias entre changes**: requiere `add-roles-permissions` implementado (aporta el `scope` y el guard) y `add-expenses-crud` implementado (o habrá que aplicarlo a expenses después).

**Contrato de API**: no cambia la forma de las respuestas, pero sí su contenido — un mismo `GET /incomes` devolverá menos filas que antes. Para el frontend actual, que aún consume mocks, no supone rotura.
