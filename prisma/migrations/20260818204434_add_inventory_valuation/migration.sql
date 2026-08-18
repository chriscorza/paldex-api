-- CreateTable
CREATE TABLE `inventory_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopify_connection_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `taken_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('PENDING', 'COMPLETE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `total_units` INTEGER NOT NULL DEFAULT 0,
    `total_cost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `products_valued` INTEGER NOT NULL DEFAULT 0,
    `products_without_cost` INTEGER NOT NULL DEFAULT 0,
    `variants_untracked` INTEGER NOT NULL DEFAULT 0,
    `failure_reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_snapshots_user_id_idx`(`user_id`),
    INDEX `inventory_snapshots_taken_at_idx`(`taken_at`),
    INDEX `inventory_snapshots_shopify_connection_id_idx`(`shopify_connection_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_snapshot_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshot_id` INTEGER NOT NULL,
    `shopify_variant_id` VARCHAR(191) NULL,
    `shopify_inventory_item_id` VARCHAR(191) NULL,
    `sku` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `location_name` VARCHAR(191) NULL,
    `quantity_on_hand` INTEGER NULL,
    `tracked` BOOLEAN NOT NULL DEFAULT true,
    `unit_cost` DECIMAL(14, 2) NULL,
    `total_cost` DECIMAL(14, 2) NULL,
    `cost_source` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_snapshot_items_snapshot_id_idx`(`snapshot_id`),
    INDEX `inventory_snapshot_items_shopify_variant_id_idx`(`shopify_variant_id`),
    INDEX `inventory_snapshot_items_sku_idx`(`sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_snapshots` ADD CONSTRAINT `inventory_snapshots_shopify_connection_id_fkey` FOREIGN KEY (`shopify_connection_id`) REFERENCES `shopify_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_snapshots` ADD CONSTRAINT `inventory_snapshots_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_snapshot_items` ADD CONSTRAINT `inventory_snapshot_items_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `inventory_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
