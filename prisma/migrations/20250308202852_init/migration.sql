/*
  Warnings:

  - You are about to drop the `_ExpenseToTax` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_IncomeToTax` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `_ExpenseToTax` DROP FOREIGN KEY `_ExpenseToTax_A_fkey`;

-- DropForeignKey
ALTER TABLE `_ExpenseToTax` DROP FOREIGN KEY `_ExpenseToTax_B_fkey`;

-- DropForeignKey
ALTER TABLE `_IncomeToTax` DROP FOREIGN KEY `_IncomeToTax_A_fkey`;

-- DropForeignKey
ALTER TABLE `_IncomeToTax` DROP FOREIGN KEY `_IncomeToTax_B_fkey`;

-- DropTable
DROP TABLE `_ExpenseToTax`;

-- DropTable
DROP TABLE `_IncomeToTax`;

-- CreateTable
CREATE TABLE `expense_taxes` (
    `expense_id` INTEGER NOT NULL,
    `tax_id` INTEGER NOT NULL,

    PRIMARY KEY (`expense_id`, `tax_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `income_taxes` (
    `income_id` INTEGER NOT NULL,
    `tax_id` INTEGER NOT NULL,

    PRIMARY KEY (`income_id`, `tax_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `expense_taxes` ADD CONSTRAINT `expense_taxes_expense_id_fkey` FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_taxes` ADD CONSTRAINT `expense_taxes_tax_id_fkey` FOREIGN KEY (`tax_id`) REFERENCES `taxes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `income_taxes` ADD CONSTRAINT `income_taxes_income_id_fkey` FOREIGN KEY (`income_id`) REFERENCES `incomes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `income_taxes` ADD CONSTRAINT `income_taxes_tax_id_fkey` FOREIGN KEY (`tax_id`) REFERENCES `taxes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
