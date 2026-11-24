-- Traspasos entre cuentas y saldo inicial con fecha (openspec/changes/add-account-transfers).


-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `initial_balance_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `account_transfers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `from_account_id` INTEGER NOT NULL,
    `to_account_id` INTEGER NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `fee_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `fee_expense_id` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` INTEGER NULL,

    UNIQUE INDEX `account_transfers_fee_expense_id_key`(`fee_expense_id`),
    INDEX `account_transfers_user_id_date_idx`(`user_id`, `date`),
    INDEX `account_transfers_from_account_id_idx`(`from_account_id`),
    INDEX `account_transfers_to_account_id_idx`(`to_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_from_account_id_fkey` FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_to_account_id_fkey` FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_fee_expense_id_fkey` FOREIGN KEY (`fee_expense_id`) REFERENCES `expenses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Permisos de traspasos. PermissionsService.syncCatalog los crearía al arrancar y se los daría a
-- admin, pero no al rol del asistente. Se insertan aquí (idempotente sobre el índice único) para
-- poder otorgarlos con alcance OWN al rol `ai_agent` si existe, sin paso manual.
INSERT IGNORE INTO `permissions` (`resource`, `action`, `scope`) VALUES
  ('account_transfer', 'create', 'ANY'),
  ('account_transfer', 'create', 'OWN'),
  ('account_transfer', 'read', 'ANY'),
  ('account_transfer', 'read', 'OWN'),
  ('account_transfer', 'update', 'ANY'),
  ('account_transfer', 'update', 'OWN'),
  ('account_transfer', 'delete', 'ANY'),
  ('account_transfer', 'delete', 'OWN');

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`resource` = 'account_transfer' AND p.`scope` = 'OWN'
WHERE r.`name` = 'ai_agent';
