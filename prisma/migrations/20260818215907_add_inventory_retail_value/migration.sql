-- AlterTable
ALTER TABLE `inventory_snapshot_items` ADD COLUMN `total_price` DECIMAL(14, 2) NULL,
    ADD COLUMN `unit_price` DECIMAL(14, 2) NULL;

-- AlterTable
ALTER TABLE `inventory_snapshots` ADD COLUMN `retail_value` DECIMAL(14, 2) NOT NULL DEFAULT 0;
