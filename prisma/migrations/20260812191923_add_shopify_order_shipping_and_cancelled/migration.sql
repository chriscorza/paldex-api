-- Envío y cancelación del pedido, dos datos que Shopify sí daba y no se
-- guardaban. Se añaden ahora, antes de reimportar el histórico, porque sólo se
-- pueden rellenar con una pasada del backfill.
--
-- `shipping_total` explica por qué el ingreso (importe cobrado, que lo incluye)
-- no cuadra con las ventas netas de Shopify (que lo excluyen). `cancelled_at`
-- permite dejar los pedidos cancelados fuera de los reportes.
--
-- Las filas ya existentes quedan con 0 y NULL hasta la reimportación.
-- AlterTable
ALTER TABLE `shopify_orders` ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `shipping_total` DOUBLE NOT NULL DEFAULT 0;
