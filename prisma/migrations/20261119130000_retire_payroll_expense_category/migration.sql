-- Retira las categorías de gasto de tipo PAYROLL (la seed "Nómina (manual)").
-- PayrollPayment es el único registro del dinero pagado a empleados.
--
-- Guardia: si algún gasto o plantilla recurrente referencia una categoría PAYROLL,
-- la migración ABORTA sin borrar nada. Hay nómina registrada dos veces y sólo una
-- persona puede decidir cuál lado se queda. El error es un "Duplicate entry '...'"
-- cuyo texto lista los ids (MySQL no tiene RAISE fuera de procedimientos, y
-- DELIMITER no existe para quien envía el script por protocolo).

-- Tabla normal y no TEMPORARY: MySQL no deja leer una temporal dos veces en la
-- misma sentencia, y la segunda insercion la lee. Si una corrida anterior abortó,
-- la tabla se queda; por eso se recrea primero.
DROP TABLE IF EXISTS `_payroll_category_guard`;
CREATE TABLE `_payroll_category_guard` (
    `detail` VARCHAR(500) NOT NULL,
    PRIMARY KEY (`detail`)
);

INSERT INTO `_payroll_category_guard` (`detail`)
SELECT LEFT(CONCAT(
         'ABORTA: categorias PAYROLL en uso. category_ids=',
         GROUP_CONCAT(DISTINCT refs.category_id ORDER BY refs.category_id),
         ' expense_ids=',
         COALESCE(GROUP_CONCAT(DISTINCT refs.expense_id ORDER BY refs.expense_id), '-'),
         ' recurring_expense_ids=',
         COALESCE(GROUP_CONCAT(DISTINCT refs.recurring_id ORDER BY refs.recurring_id), '-')
       ), 500)
FROM (
    SELECT e.`category_id` AS category_id, e.`id` AS expense_id, NULL AS recurring_id
    FROM `expenses` e
    JOIN `expense_categories` c ON c.`id` = e.`category_id`
    WHERE c.`type` = 'PAYROLL'
    UNION ALL
    SELECT r.`category_id`, NULL, r.`id`
    FROM `recurring_expenses` r
    JOIN `expense_categories` c ON c.`id` = r.`category_id`
    WHERE c.`type` = 'PAYROLL'
) refs
HAVING COUNT(*) > 0;

-- Segunda insercion identica: si la guardia inserto algo, esta choca con la llave
-- primaria y la migracion falla mostrando los ids. Si no habia nada, no hace nada.
INSERT INTO `_payroll_category_guard` (`detail`)
SELECT `detail` FROM `_payroll_category_guard`;

DROP TABLE `_payroll_category_guard`;

DELETE FROM `expense_categories` WHERE `type` = 'PAYROLL';
