-- Un socio del mismo negocio trabaja en los libros de otra cuenta.
ALTER TABLE `users` ADD COLUMN `books_owner_id` INTEGER NULL;

ALTER TABLE `users` ADD CONSTRAINT `users_books_owner_id_fkey` FOREIGN KEY (`books_owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
