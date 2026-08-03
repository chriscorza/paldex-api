-- AlterTable
ALTER TABLE `users` ADD COLUMN `role_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `resource` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `scope` ENUM('OWN', 'ANY') NOT NULL DEFAULT 'ANY',
    `description` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_resource_action_scope_key`(`resource`, `action`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` INTEGER NOT NULL,
    `permission_id` INTEGER NOT NULL,

    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: system roles
INSERT INTO `roles` (`name`, `description`, `is_system`) VALUES
  ("admin", "Administrador del sistema", true),
  ("user", "Usuario estandar", true);

-- Backfill: permission catalog
INSERT INTO `permissions` (`resource`, `action`, `scope`, `description`) VALUES
  ("income", "read", "ANY", "Leer ingresos"),
  ("income", "create", "ANY", "Crear ingresos"),
  ("income", "update", "ANY", "Actualizar ingresos"),
  ("income", "delete", "ANY", "Borrar ingresos"),
  ("expense", "read", "ANY", "Leer gastos"),
  ("expense", "create", "ANY", "Crear gastos"),
  ("expense", "update", "ANY", "Actualizar gastos"),
  ("expense", "delete", "ANY", "Borrar gastos"),
  ("account", "read", "ANY", "Leer cuentas"),
  ("account", "create", "ANY", "Crear cuentas"),
  ("account", "update", "ANY", "Actualizar cuentas"),
  ("account", "delete", "ANY", "Borrar cuentas"),
  ("tax", "read", "ANY", "Leer impuestos"),
  ("tax", "create", "ANY", "Crear impuestos"),
  ("tax", "update", "ANY", "Actualizar impuestos"),
  ("tax", "delete", "ANY", "Borrar impuestos"),
  ("user", "read", "ANY", "Leer usuarios"),
  ("user", "create", "ANY", "Crear usuarios"),
  ("user", "update", "ANY", "Actualizar usuarios"),
  ("user", "delete", "ANY", "Borrar usuarios"),
  ("user", "assign_role", "ANY", "Asignar rol a usuario"),
  ("role", "read", "ANY", "Leer roles"),
  ("role", "create", "ANY", "Crear roles"),
  ("role", "update", "ANY", "Actualizar roles"),
  ("role", "delete", "ANY", "Borrar roles"),
  ("permission", "read", "ANY", "Leer catalogo de permisos");

-- Backfill: admin gets all permissions
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT r.id, p.id FROM `roles` r CROSS JOIN `permissions` p WHERE r.name = "admin";

-- Backfill: user gets operational subset
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT r.id, p.id FROM `roles` r CROSS JOIN `permissions` p
  WHERE r.name = "user"
    AND p.resource IN ("income", "expense", "account", "tax");

-- Backfill: assign role user to all existing users
UPDATE `users` SET `role_id` = (SELECT id FROM `roles` WHERE name = "user") WHERE `role_id` IS NULL;
