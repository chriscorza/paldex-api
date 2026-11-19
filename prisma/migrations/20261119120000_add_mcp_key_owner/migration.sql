-- AlterTable
ALTER TABLE `mcp_api_keys` ADD COLUMN `owner_user_id` INTEGER NULL;

-- Backfill: cada llave existente sigue actuando como ella misma hasta que un
-- operador la apunte a una persona real (PATCH /mcp-keys/:id).
UPDATE `mcp_api_keys` SET `owner_user_id` = `user_id` WHERE `owner_user_id` IS NULL;

-- CreateIndex
CREATE INDEX `mcp_api_keys_owner_user_id_idx` ON `mcp_api_keys`(`owner_user_id`);

-- AddForeignKey
ALTER TABLE `mcp_api_keys` ADD CONSTRAINT `mcp_api_keys_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
