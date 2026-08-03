-- CreateTable
CREATE TABLE `shopify_line_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopify_order_id` INTEGER NOT NULL,
    `shopify_line_item_id` VARCHAR(191) NOT NULL,
    `shopify_product_id` VARCHAR(191) NULL,
    `shopify_variant_id` VARCHAR(191) NULL,
    `sku` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `variant_title` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `unit_price` DECIMAL(14, 2) NOT NULL,
    `discount_allocated` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `tax_allocated` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `category_name` VARCHAR(191) NULL,
    `category_source` ENUM('PRODUCT_TYPE', 'COLLECTION', 'TAG', 'MANUAL', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `unit_cost` DECIMAL(14, 2) NULL,
    `total_cost` DECIMAL(14, 2) NULL,
    `gross_sales` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net_sales` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `gross_profit` DECIMAL(14, 2) NULL,
    `profit_margin` DECIMAL(14, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shopify_line_items_category_name_idx`(`category_name`),
    INDEX `shopify_line_items_sku_idx`(`sku`),
    INDEX `shopify_line_items_shopify_variant_id_idx`(`shopify_variant_id`),
    UNIQUE INDEX `shopify_line_items_shopify_order_id_shopify_line_item_id_key`(`shopify_order_id`, `shopify_line_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_costs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopify_variant_id` VARCHAR(191) NULL,
    `sku` VARCHAR(191) NULL,
    `unit_cost` DECIMAL(14, 2) NOT NULL,
    `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `source` ENUM('MANUAL', 'SHOPIFY_INVENTORY', 'IMPORTED') NOT NULL DEFAULT 'MANUAL',
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_costs_shopify_variant_id_idx`(`shopify_variant_id`),
    INDEX `product_costs_sku_idx`(`sku`),
    INDEX `product_costs_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_category_overrides` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopify_product_id` VARCHAR(191) NOT NULL,
    `category_name` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_category_overrides_user_id_shopify_product_id_key`(`user_id`, `shopify_product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shopify_line_items` ADD CONSTRAINT `shopify_line_items_shopify_order_id_fkey` FOREIGN KEY (`shopify_order_id`) REFERENCES `shopify_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_costs` ADD CONSTRAINT `product_costs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_category_overrides` ADD CONSTRAINT `product_category_overrides_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
