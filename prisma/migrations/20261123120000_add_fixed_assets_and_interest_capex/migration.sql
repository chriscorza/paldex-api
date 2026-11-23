-- AlterTable
ALTER TABLE `expense_categories` MODIFY `type` ENUM('COGS', 'OPERATING', 'PAYROLL', 'TAX', 'SHOPIFY_FEES', 'SHIPPING', 'MARKETING', 'DEBT', 'OWNER', 'OTHER', 'INTEREST', 'CAPEX') NOT NULL;

-- CreateTable
CREATE TABLE `fixed_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('TANGIBLE', 'INTANGIBLE') NOT NULL DEFAULT 'TANGIBLE',
    `asset_class` ENUM('COMPUTER', 'VEHICLE', 'FURNITURE', 'MACHINERY', 'LEASEHOLD_IMPROVEMENT', 'SOFTWARE', 'OTHER') NOT NULL,
    `acquisition_cost` DECIMAL(14, 2) NOT NULL,
    `acquired_at` DATETIME(3) NOT NULL,
    `in_service_at` DATETIME(3) NOT NULL,
    `useful_life_months` INTEGER NOT NULL,
    `salvage_value` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `disposed_at` DATETIME(3) NULL,
    `disposal_amount` DECIMAL(14, 2) NULL,
    `expense_id` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fixed_assets_user_id_idx`(`user_id`),
    INDEX `fixed_assets_in_service_at_idx`(`in_service_at`),
    INDEX `fixed_assets_expense_id_idx`(`expense_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_expense_id_fkey` FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Los intereses salen de la operación: en el estado de resultados van abajo
-- del EBIT, fuera del EBITDA. Sólo la categoría del sistema; las DEBT que creó
-- el usuario siguen siendo pago de capital.
-- GET /reports/monthly no cambia: sumExpensesByPurpose suma INTEREST a la
-- operación mientras ese reporte no se alinee (design.md, decisión 3).
UPDATE `expense_categories`
SET `type` = 'INTEREST', `affects_operating_profit` = false
WHERE `is_system` = true AND `type` = 'DEBT' AND `name` = 'Intereses de deuda';

-- "Compra de activo fijo" (CAPEX) no se inserta aquí: DataSeedService la
-- siembra al arrancar para cada cuenta, igual que el resto de SYSTEM_CATEGORIES.
