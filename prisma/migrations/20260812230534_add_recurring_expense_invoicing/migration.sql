-- Un gasto recurrente que llega con factura.
--
-- La plantilla generaba siempre `NOT_INVOICED`, así que un gasto fijo facturado
-- —el estacionamiento, los servicios— caía en el cubo de "sin factura" del
-- reporte fiscal y su IVA no se acreditaba en ninguna parte.
--
-- `tax_rate` es el porcentaje de IVA sobre el importe, que se entiende
-- incluido: con 1,000 al 16 % el subtotal son 862.07 y el acreditable 137.93.
-- Para un gasto de 1,000 + IVA se captura el importe ya sumado, 1,160.
-- AlterTable
ALTER TABLE `recurring_expenses` ADD COLUMN `invoice_status` ENUM('NOT_INVOICED', 'PENDING_INVOICE', 'INVOICED', 'NOT_DEDUCTIBLE') NOT NULL DEFAULT 'NOT_INVOICED',
    ADD COLUMN `tax_rate` DECIMAL(5, 2) NULL;
