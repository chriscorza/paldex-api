-- Quién capturó cada registro. Nulo = sistema (Shopify, generadores automáticos).

ALTER TABLE `expenses` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `incomes` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payables` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `payables` ADD CONSTRAINT `payables_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `receivables` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `receivables` ADD CONSTRAINT `receivables_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `tax_payments` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `tax_payments` ADD CONSTRAINT `tax_payments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payroll_payments` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `payroll_payments` ADD CONSTRAINT `payroll_payments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `fixed_assets` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `recurring_expenses` ADD COLUMN `created_by` INTEGER NULL;
ALTER TABLE `recurring_expenses` ADD CONSTRAINT `recurring_expenses_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Histórico: hasta hoy sólo el dueño de los libros capturaba a mano, así que se le
-- atribuye lo manual. Lo que vino de Shopify o de un generador queda nulo (sistema).
UPDATE `expenses` SET `created_by` = `user_id` WHERE `recurring_expense_id` IS NULL;
UPDATE `incomes` SET `created_by` = `user_id` WHERE `source` IS NULL OR `source` <> 'shopify';
UPDATE `payables` SET `created_by` = `user_id`;
UPDATE `receivables` SET `created_by` = `user_id`;
UPDATE `tax_payments` SET `created_by` = `user_id`;
UPDATE `fixed_assets` SET `created_by` = `user_id`;
UPDATE `recurring_expenses` SET `created_by` = `user_id`;
UPDATE `payroll_payments` p JOIN `employees` e ON e.`id` = p.`employee_id`
SET p.`created_by` = e.`user_id` WHERE p.`auto_generated` = false;
