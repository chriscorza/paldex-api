-- CreateTable
CREATE TABLE `mcp_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key_id` INTEGER NULL,
    `caller_user_id` INTEGER NOT NULL,
    `owner_user_id` INTEGER NOT NULL,
    `tool` VARCHAR(64) NOT NULL,
    `entity` VARCHAR(64) NOT NULL,
    `entity_id` INTEGER NULL,
    `action` VARCHAR(32) NOT NULL,
    `client_ref` VARCHAR(100) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mcp_actions_owner_user_id_entity_entity_id_idx`(`owner_user_id`, `entity`, `entity_id`),
    INDEX `mcp_actions_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
    UNIQUE INDEX `mcp_actions_owner_user_id_tool_client_ref_key`(`owner_user_id`, `tool`, `client_ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mcp_actions` ADD CONSTRAINT `mcp_actions_key_id_fkey` FOREIGN KEY (`key_id`) REFERENCES `mcp_api_keys`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mcp_actions` ADD CONSTRAINT `mcp_actions_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

