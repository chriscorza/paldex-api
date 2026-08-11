-- CreateTable
CREATE TABLE `shopify_gateway_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopify_connection_id` INTEGER NOT NULL,
    `gateway` VARCHAR(191) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `shopify_gateway_accounts_shopify_connection_id_gateway_key`(`shopify_connection_id`, `gateway`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shopify_gateway_accounts` ADD CONSTRAINT `shopify_gateway_accounts_shopify_connection_id_fkey` FOREIGN KEY (`shopify_connection_id`) REFERENCES `shopify_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shopify_gateway_accounts` ADD CONSTRAINT `shopify_gateway_accounts_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
