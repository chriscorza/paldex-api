-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'MXN',
    ADD COLUMN `initial_balance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true,
    MODIFY `balance` DECIMAL(14, 2) NOT NULL,
    MODIFY `credit_limit` DECIMAL(14, 2) NULL;

-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `category_id` INTEGER NULL,
    ADD COLUMN `invoice_status` ENUM('NOT_INVOICED', 'PENDING_INVOICE', 'INVOICED', 'NOT_DEDUCTIBLE') NOT NULL DEFAULT 'NOT_INVOICED',
    ADD COLUMN `invoice_uuid` VARCHAR(191) NULL,
    ADD COLUMN `is_tax_deductible` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `paid_at` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('PENDING', 'PAID', 'SKIPPED', 'CANCELLED') NOT NULL DEFAULT 'PAID',
    ADD COLUMN `subtotal` DECIMAL(14, 2) NULL,
    ADD COLUMN `supplier_rfc` VARCHAR(191) NULL,
    ADD COLUMN `tax_amount` DECIMAL(14, 2) NULL,
    ADD COLUMN `tax_creditable_amount` DECIMAL(14, 2) NULL DEFAULT 0,
    ADD COLUMN `vendor` VARCHAR(191) NULL,
    ADD COLUMN `withholding_amount` DECIMAL(14, 2) NULL,
    MODIFY `amount` DECIMAL(14, 2) NOT NULL;

-- AlterTable
ALTER TABLE `incomes` ADD COLUMN `channel` VARCHAR(191) NULL,
    ADD COLUMN `cogs_total` DECIMAL(14, 2) NULL,
    ADD COLUMN `discount_total` DECIMAL(14, 2) NULL DEFAULT 0,
    ADD COLUMN `fee_total` DECIMAL(14, 2) NULL DEFAULT 0,
    ADD COLUMN `gross_amount` DECIMAL(14, 2) NULL,
    ADD COLUMN `income_type` ENUM('SHOPIFY_ORDER', 'SHOPIFY_REFUND', 'MANUAL_ADJUSTMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `net_amount` DECIMAL(14, 2) NULL,
    ADD COLUMN `profit_gross` DECIMAL(14, 2) NULL,
    ADD COLUMN `shipping_charged` DECIMAL(14, 2) NULL DEFAULT 0,
    ADD COLUMN `shipping_cost` DECIMAL(14, 2) NULL DEFAULT 0,
    MODIFY `amount` DECIMAL(14, 2) NOT NULL;

-- CreateTable
CREATE TABLE `expense_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('COGS', 'OPERATING', 'PAYROLL', 'TAX', 'SHOPIFY_FEES', 'SHIPPING', 'MARKETING', 'DEBT', 'OWNER', 'OTHER') NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `affects_gross_profit` BOOLEAN NOT NULL DEFAULT false,
    `affects_operating_profit` BOOLEAN NOT NULL DEFAULT true,
    `is_cash_outflow` BOOLEAN NOT NULL DEFAULT true,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `expense_categories_user_id_name_type_key`(`user_id`, `name`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_of_goods_sold` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `income_id` INTEGER NOT NULL,
    `product_reference` VARCHAR(191) NULL,
    `quantity` DECIMAL(14, 2) NOT NULL,
    `unit_cost` DECIMAL(14, 2) NOT NULL,
    `total_cost` DECIMAL(14, 2) NOT NULL,
    `source` ENUM('MANUAL', 'SHOPIFY', 'THIRD_PARTY') NOT NULL DEFAULT 'MANUAL',
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cost_of_goods_sold_income_id_idx`(`income_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `position` VARCHAR(191) NULL,
    `salary_type` ENUM('SALARIED', 'HOURLY', 'COMMISSION', 'PER_DIEM') NOT NULL DEFAULT 'SALARIED',
    `pay_frequency` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY') NOT NULL DEFAULT 'MONTHLY',
    `base_salary` DECIMAL(14, 2) NOT NULL,
    `weekly_pay_day` INTEGER NULL,
    `biweekly_first_day` INTEGER NULL,
    `biweekly_second_day` INTEGER NULL,
    `monthly_pay_day` INTEGER NULL,
    `default_payment_account_id` INTEGER NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `user_id` INTEGER NOT NULL,

    INDEX `employees_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `scheduled_pay_date` DATETIME(3) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `pay_frequency_snapshot` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY') NOT NULL,
    `gross_amount` DECIMAL(14, 2) NOT NULL,
    `deductions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `bonuses` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `account_id` INTEGER NULL,
    `status` ENUM('SCHEDULED', 'PENDING', 'PAID', 'CANCELLED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `auto_generated` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_payments_scheduled_pay_date_idx`(`scheduled_pay_date`),
    INDEX `payroll_payments_paid_at_idx`(`paid_at`),
    INDEX `payroll_payments_employee_id_idx`(`employee_id`),
    UNIQUE INDEX `payroll_payments_employee_id_scheduled_pay_date_period_start_key`(`employee_id`, `scheduled_pay_date`, `period_start`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('IVA', 'ISR', 'PAYROLL_TAX', 'OTHER') NOT NULL,
    `tax_id` VARCHAR(191) NULL,
    `fiscal_period_start` DATETIME(3) NOT NULL,
    `fiscal_period_end` DATETIME(3) NOT NULL,
    `due_date` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `notes` VARCHAR(191) NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tax_payments_paid_at_idx`(`paid_at`),
    INDEX `tax_payments_fiscal_period_start_idx`(`fiscal_period_start`),
    INDEX `tax_payments_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `expenses_paid_at_idx` ON `expenses`(`paid_at`);

-- CreateIndex
CREATE INDEX `expenses_category_id_idx` ON `expenses`(`category_id`);

-- CreateIndex
CREATE INDEX `incomes_date_idx` ON `incomes`(`date`);

-- CreateIndex
CREATE INDEX `incomes_income_type_idx` ON `incomes`(`income_type`);

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_of_goods_sold` ADD CONSTRAINT `cost_of_goods_sold_income_id_fkey` FOREIGN KEY (`income_id`) REFERENCES `incomes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_default_payment_account_id_fkey` FOREIGN KEY (`default_payment_account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_payments` ADD CONSTRAINT `payroll_payments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_payments` ADD CONSTRAINT `payroll_payments_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_payments` ADD CONSTRAINT `tax_payments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_payments` ADD CONSTRAINT `tax_payments_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: Accounts
UPDATE `accounts` SET `initial_balance` = `balance`, `currency` = 'MXN', `is_active` = true;

-- Backfill: Expenses
UPDATE `expenses` SET `status` = 'PAID', `paid_at` = `date`, `invoice_status` = CASE WHEN `invoiced` = 1 THEN 'INVOICED' ELSE 'NOT_INVOICED' END, `is_tax_deductible` = true, `tax_creditable_amount` = 0;

-- Backfill: Incomes
UPDATE `incomes` SET `gross_amount` = `amount`, `net_amount` = `amount`, `income_type` = CASE WHEN `source` = 'SHOPIFY' THEN 'SHOPIFY_ORDER' ELSE 'OTHER' END, `channel` = `source`;
