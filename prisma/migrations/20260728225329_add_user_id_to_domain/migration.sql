-- Add columns as nullable first
ALTER TABLE `accounts` ADD COLUMN `user_id` INTEGER NULL;
ALTER TABLE `expenses` ADD COLUMN `user_id` INTEGER NULL;
ALTER TABLE `incomes` ADD COLUMN `user_id` INTEGER NULL;

-- Backfill: assign all rows to admin user
UPDATE `accounts` SET `user_id` = (SELECT id FROM `users` WHERE role_id = (SELECT id FROM `roles` WHERE name = "admin") LIMIT 1) WHERE `user_id` IS NULL;
UPDATE `expenses` SET `user_id` = (SELECT id FROM `users` WHERE role_id = (SELECT id FROM `roles` WHERE name = "admin") LIMIT 1) WHERE `user_id` IS NULL;
UPDATE `incomes` SET `user_id` = (SELECT id FROM `users` WHERE role_id = (SELECT id FROM `roles` WHERE name = "admin") LIMIT 1) WHERE `user_id` IS NULL;

-- Make NOT NULL
ALTER TABLE `accounts` MODIFY COLUMN `user_id` INTEGER NOT NULL;
ALTER TABLE `expenses` MODIFY COLUMN `user_id` INTEGER NOT NULL;
ALTER TABLE `incomes` MODIFY COLUMN `user_id` INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX `accounts_user_id_idx` ON `accounts`(`user_id`);
CREATE INDEX `expenses_user_id_idx` ON `expenses`(`user_id`);
CREATE INDEX `incomes_user_id_idx` ON `incomes`(`user_id`);

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
