-- Backfill migration: `recurring_expenses`, `payables`, `payable_payments`,
-- `receivables`, `receivable_collections` and `monthly_closes` were added to
-- schema.prisma in commit 9528b29 ("add-financial-model-core") but no
-- migration file was ever generated for them, so the tables never existed
-- outside of a developer's local `db push`. This migration creates them now.

-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `is_recurring` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `recurring_expense_id` INTEGER NULL,
    ADD COLUMN `scheduled_due_date` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `recurring_expenses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `concept` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `category_id` INTEGER NOT NULL,
    `account_id` INTEGER NULL,
    `frequency` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY') NOT NULL,
    `due_day_of_week` INTEGER NULL,
    `due_day_of_month` INTEGER NULL,
    `second_due_day_of_month` INTEGER NULL,
    `start_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `end_date` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `auto_generate` BOOLEAN NOT NULL DEFAULT true,
    `requires_confirmation` BOOLEAN NOT NULL DEFAULT true,
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recurring_expenses_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendor` VARCHAR(191) NOT NULL,
    `concept` VARCHAR(191) NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `paid_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `due_date` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
    `account_id` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payables_due_date_idx`(`due_date`),
    INDEX `payables_status_idx`(`status`),
    INDEX `payables_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payable_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payable_id` INTEGER NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `account_id` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receivables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer` VARCHAR(191) NOT NULL,
    `concept` VARCHAR(191) NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `collected_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `due_date` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'PARTIAL', 'COLLECTED', 'CANCELLED', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
    `related_income_id` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `receivables_due_date_idx`(`due_date`),
    INDEX `receivables_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receivable_collections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receivable_id` INTEGER NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `collected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `account_id` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monthly_closes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `status` ENUM('OPEN', 'REVIEWING', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `income_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `expense_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `cogs_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `payroll_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net_profit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `cash_available` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `source_fingerprint` JSON NULL,
    `fingerprint_version` INTEGER NULL,
    `closed_at` DATETIME(3) NULL,
    `closed_by_user_id` INTEGER NULL,
    `reopened_reason` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `monthly_closes_year_month_idx`(`year`, `month`),
    UNIQUE INDEX `monthly_closes_user_id_year_month_key`(`user_id`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `expenses_recurring_expense_id_scheduled_due_date_key` ON `expenses`(`recurring_expense_id`, `scheduled_due_date`);

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_recurring_expense_id_fkey` FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurring_expenses` ADD CONSTRAINT `recurring_expenses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payables` ADD CONSTRAINT `payables_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payable_payments` ADD CONSTRAINT `payable_payments_payable_id_fkey` FOREIGN KEY (`payable_id`) REFERENCES `payables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receivables` ADD CONSTRAINT `receivables_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receivable_collections` ADD CONSTRAINT `receivable_collections_receivable_id_fkey` FOREIGN KEY (`receivable_id`) REFERENCES `receivables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
