-- CreateTable
CREATE TABLE `invitations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `user_id` INTEGER NULL,
    `invited_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `invitations_email_key`(`email`),
    UNIQUE INDEX `invitations_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every user that already exists at the time this migration runs
-- is treated as already invited, so nobody is retroactively locked out.
INSERT INTO `invitations` (`email`, `status`, `user_id`, `accepted_at`, `created_at`)
SELECT `email`, 'ACTIVE', `id`, `created_at`, `created_at` FROM `users`;
