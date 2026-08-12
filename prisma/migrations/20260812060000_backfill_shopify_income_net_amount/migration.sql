-- Rellena el desglose comercial de los ingresos de Shopify ya sincronizados.
--
-- `handleTransactionCreate` creaba el ingreso con Prisma directo, saltándose el
-- cálculo de `IncomesService.create` que fija neto y bruto cuando no hay
-- desglose. La columna quedaba en NULL, y como `net_sales` se calcula con
-- `SUM(income.net_amount)`, todas las ventas de Shopify contaban cero en los
-- reportes de P&L, en las comparativas y en las tendencias.
--
-- Neto = bruto = importe cobrado, igual que hace ahora el sincronizador: el
-- importe de la transacción ya viene con los descuentos aplicados.
--
-- Sólo toca filas donde la columna está vacía, así que no pisa ningún dato
-- capturado a mano y se puede volver a aplicar sin efecto.
UPDATE `incomes`
SET `net_amount` = `amount`
WHERE `source` = 'shopify' AND `net_amount` IS NULL;

UPDATE `incomes`
SET `gross_amount` = `amount`
WHERE `source` = 'shopify' AND `gross_amount` IS NULL;
