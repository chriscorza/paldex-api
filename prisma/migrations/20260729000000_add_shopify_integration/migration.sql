-- CreateTable
CREATE TABLE `shopify_connections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `shop_domain` VARCHAR(191) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `access_token` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED', 'ERROR') NOT NULL DEFAULT 'ACTIVE',
    `installed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_synced_at` DATETIME(3) NULL,

    UNIQUE INDEX `shopify_connections_shop_domain_key`(`shop_domain`),
    INDEX `shopify_connections_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shopify_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopify_connection_id` INTEGER NOT NULL,
    `external_order_id` VARCHAR(191) NOT NULL,
    `order_number` INTEGER NOT NULL,
    `items_total` DOUBLE NOT NULL,
    `shopify_order_total` DOUBLE NULL,
    `discount_total` DOUBLE NOT NULL,
    `tax_total` DOUBLE NOT NULL,
    `cost_total` DOUBLE NOT NULL,
    `profit_total` DOUBLE NOT NULL,
    `has_missing_cost_data` BOOLEAN NOT NULL DEFAULT false,
    `line_items` JSON NOT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shopify_orders_shopify_connection_id_external_order_id_key`(`shopify_connection_id`, `external_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `incomes` ADD COLUMN `source` VARCHAR(191) NULL,
    ADD COLUMN `external_transaction_id` VARCHAR(191) NULL,
    ADD COLUMN `external_reference` VARCHAR(191) NULL,
    ADD COLUMN `shopify_order_id` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `incomes_source_external_transaction_id_key` ON `incomes`(`source`, `external_transaction_id`);

-- AddForeignKey
ALTER TABLE `shopify_connections` ADD CONSTRAINT `shopify_connections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `shopify_connections` ADD CONSTRAINT `shopify_connections_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `shopify_orders` ADD CONSTRAINT `shopify_orders_shopify_connection_id_fkey` FOREIGN KEY (`shopify_connection_id`) REFERENCES `shopify_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `incomes` ADD CONSTRAINT `incomes_shopify_order_id_fkey` FOREIGN KEY (`shopify_order_id`) REFERENCES `shopify_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
