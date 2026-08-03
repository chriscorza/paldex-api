mysqldump: [Warning] Using a password on the command line interface can be insecure.
-- MySQL dump 10.13  Distrib 8.4.1, for Linux (x86_64)
--
-- Host: localhost    Database: paldex
-- ------------------------------------------------------
-- Server version	8.4.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `_prisma_migrations`
--

DROP TABLE IF EXISTS `_prisma_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `_prisma_migrations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `migration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logs` text COLLATE utf8mb4_unicode_ci,
  `rolled_back_at` datetime(3) DEFAULT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_steps_count` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `_prisma_migrations`
--

LOCK TABLES `_prisma_migrations` WRITE;
/*!40000 ALTER TABLE `_prisma_migrations` DISABLE KEYS */;
INSERT INTO `_prisma_migrations` VALUES ('51fd5ea9-708b-4d5d-bc37-5a3eed359ce6','3990fb152a406c6a79526c9d2b6385b5393d19131ab60e315f309e08b9823ec7','2026-07-28 22:29:31.751','20260728222839_add_roles_permissions',NULL,NULL,'2026-07-28 22:29:31.631',1),('66db4b8e-75a7-4926-9226-310afcadd4f6','a61454a35ffda3b013c13ee9766e3d9f4b1f020a46c03123b99706e50f3af112','2026-07-28 23:15:36.407','20260729000000_add_shopify_integration',NULL,NULL,'2026-07-28 23:15:36.225',1),('a8befb7b-59cb-4919-8978-b375e9599da6','7cfbc7ddda5a06b84800ae9f648a8fa2b85838f3bf187593a374f51e6def3685','2026-07-28 19:13:54.377','20250308202852_init',NULL,NULL,'2026-07-28 19:13:54.228',1),('ee7c02b6-a2a7-45f9-8035-afe00d6a73d6','63f7d124264fa1fa7739445411bd6f924eadf37e6749e84c00e4cf2d1496de5d','2026-07-28 19:13:54.226','20250308202418_init',NULL,NULL,'2026-07-28 19:13:53.999',1),('f68361d0-e768-44c2-abc1-adeb7d4dfb64','7f1f1fb25e25a3d05b4d7ac5ee492c0fdece7b681654967b997c0ca6dcf6eefb','2026-07-28 22:53:49.387','20260728225329_add_user_id_to_domain',NULL,NULL,'2026-07-28 22:53:49.163',1);
/*!40000 ALTER TABLE `_prisma_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `accounts`
--

DROP TABLE IF EXISTS `accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `balance` double NOT NULL,
  `credit_limit` double DEFAULT NULL,
  `type` enum('CASH','CREDIT_CARD','DEBIT_CARD','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `user_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `accounts_user_id_idx` (`user_id`),
  CONSTRAINT `accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `accounts`
--

LOCK TABLES `accounts` WRITE;
/*!40000 ALTER TABLE `accounts` DISABLE KEYS */;
INSERT INTO `accounts` VALUES (1,'Cuenta Principal',5000,NULL,'CASH','2026-07-28 22:01:52.014',4),(2,'Tarjeta CrÃ©dito',2000,NULL,'CREDIT_CARD','2026-07-28 22:01:52.014',4),(4,'Visa',-300,2000,'CREDIT_CARD','2026-07-28 22:09:38.056',4),(5,'Débito',500,NULL,'DEBIT_CARD','2026-07-28 22:09:38.086',4),(6,'Otros',0,NULL,'OTHER','2026-07-28 22:09:38.118',4),(7,'Cuenta de Alice',1000,NULL,'CASH','2026-07-28 22:58:37.983',12),(8,'Cuenta de Bob',500,NULL,'CASH','2026-07-28 22:58:38.031',13);
/*!40000 ALTER TABLE `accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `expense_taxes`
--

DROP TABLE IF EXISTS `expense_taxes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expense_taxes` (
  `expense_id` int NOT NULL,
  `tax_id` int NOT NULL,
  PRIMARY KEY (`expense_id`,`tax_id`),
  KEY `expense_taxes_tax_id_fkey` (`tax_id`),
  CONSTRAINT `expense_taxes_expense_id_fkey` FOREIGN KEY (`expense_id`) REFERENCES `expenses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `expense_taxes_tax_id_fkey` FOREIGN KEY (`tax_id`) REFERENCES `taxes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `expense_taxes`
--

LOCK TABLES `expense_taxes` WRITE;
/*!40000 ALTER TABLE `expense_taxes` DISABLE KEYS */;
/*!40000 ALTER TABLE `expense_taxes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `expenses`
--

DROP TABLE IF EXISTS `expenses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `amount` double NOT NULL,
  `concept` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` datetime(3) NOT NULL,
  `invoiced` tinyint(1) NOT NULL,
  `account_id` int NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `user_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `expenses_account_id_fkey` (`account_id`),
  KEY `expenses_user_id_idx` (`user_id`),
  CONSTRAINT `expenses_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `expenses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `expenses`
--

LOCK TABLES `expenses` WRITE;
/*!40000 ALTER TABLE `expenses` DISABLE KEYS */;
/*!40000 ALTER TABLE `expenses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `income_taxes`
--

DROP TABLE IF EXISTS `income_taxes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `income_taxes` (
  `income_id` int NOT NULL,
  `tax_id` int NOT NULL,
  PRIMARY KEY (`income_id`,`tax_id`),
  KEY `income_taxes_tax_id_fkey` (`tax_id`),
  CONSTRAINT `income_taxes_income_id_fkey` FOREIGN KEY (`income_id`) REFERENCES `incomes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `income_taxes_tax_id_fkey` FOREIGN KEY (`tax_id`) REFERENCES `taxes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `income_taxes`
--

LOCK TABLES `income_taxes` WRITE;
/*!40000 ALTER TABLE `income_taxes` DISABLE KEYS */;
/*!40000 ALTER TABLE `income_taxes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `incomes`
--

DROP TABLE IF EXISTS `incomes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incomes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `amount` double NOT NULL,
  `concept` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` datetime(3) NOT NULL,
  `invoiced` tinyint(1) NOT NULL,
  `account_id` int NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `user_id` int NOT NULL,
  `source` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_transaction_id` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_reference` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shopify_order_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `incomes_source_external_transaction_id_key` (`source`,`external_transaction_id`),
  KEY `incomes_account_id_fkey` (`account_id`),
  KEY `incomes_user_id_idx` (`user_id`),
  KEY `incomes_shopify_order_id_fkey` (`shopify_order_id`),
  CONSTRAINT `incomes_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `incomes_shopify_order_id_fkey` FOREIGN KEY (`shopify_order_id`) REFERENCES `shopify_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `incomes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `incomes`
--

LOCK TABLES `incomes` WRITE;
/*!40000 ALTER TABLE `incomes` DISABLE KEYS */;
INSERT INTO `incomes` VALUES (7,500,'Sueldo Alice','2026-01-01 00:00:00.000',0,7,'2026-07-28 22:58:38.011',12,NULL,NULL,NULL,NULL),(8,300,'Sueldo Bob','2026-01-01 00:00:00.000',0,8,'2026-07-28 22:58:38.056',13,NULL,NULL,NULL,NULL),(9,100,'Cross','2026-01-01 00:00:00.000',0,8,'2026-07-28 22:58:38.195',12,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `incomes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `permissions`
--

DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `resource` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope` enum('OWN','ANY') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ANY',
  `description` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `permissions_resource_action_scope_key` (`resource`,`action`,`scope`)
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `permissions`
--

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` VALUES (1,'income','read','ANY','Leer ingresos','2026-07-28 22:29:31.742'),(2,'income','create','ANY','Crear ingresos','2026-07-28 22:29:31.742'),(3,'income','update','ANY','Actualizar ingresos','2026-07-28 22:29:31.742'),(4,'income','delete','ANY','Borrar ingresos','2026-07-28 22:29:31.742'),(5,'expense','read','ANY','Leer gastos','2026-07-28 22:29:31.742'),(6,'expense','create','ANY','Crear gastos','2026-07-28 22:29:31.742'),(7,'expense','update','ANY','Actualizar gastos','2026-07-28 22:29:31.742'),(8,'expense','delete','ANY','Borrar gastos','2026-07-28 22:29:31.742'),(9,'account','read','ANY','Leer cuentas','2026-07-28 22:29:31.742'),(10,'account','create','ANY','Crear cuentas','2026-07-28 22:29:31.742'),(11,'account','update','ANY','Actualizar cuentas','2026-07-28 22:29:31.742'),(12,'account','delete','ANY','Borrar cuentas','2026-07-28 22:29:31.742'),(13,'tax','read','ANY','Leer impuestos','2026-07-28 22:29:31.742'),(14,'tax','create','ANY','Crear impuestos','2026-07-28 22:29:31.742'),(15,'tax','update','ANY','Actualizar impuestos','2026-07-28 22:29:31.742'),(16,'tax','delete','ANY','Borrar impuestos','2026-07-28 22:29:31.742'),(17,'user','read','ANY','Leer usuarios','2026-07-28 22:29:31.742'),(18,'user','create','ANY','Crear usuarios','2026-07-28 22:29:31.742'),(19,'user','update','ANY','Actualizar usuarios','2026-07-28 22:29:31.742'),(20,'user','delete','ANY','Borrar usuarios','2026-07-28 22:29:31.742'),(21,'user','assign_role','ANY','Asignar rol a usuario','2026-07-28 22:29:31.742'),(22,'role','read','ANY','Leer roles','2026-07-28 22:29:31.742'),(23,'role','create','ANY','Crear roles','2026-07-28 22:29:31.742'),(24,'role','update','ANY','Actualizar roles','2026-07-28 22:29:31.742'),(25,'role','delete','ANY','Borrar roles','2026-07-28 22:29:31.742'),(26,'permission','read','ANY','Leer catalogo de permisos','2026-07-28 22:29:31.742'),(27,'income','read','OWN',NULL,'2026-07-28 22:54:19.326'),(28,'income','create','OWN',NULL,'2026-07-28 22:54:19.341'),(29,'income','update','OWN',NULL,'2026-07-28 22:54:19.352'),(30,'income','delete','OWN',NULL,'2026-07-28 22:54:19.366'),(31,'expense','read','OWN',NULL,'2026-07-28 22:54:19.380'),(32,'expense','create','OWN',NULL,'2026-07-28 22:54:19.387'),(33,'expense','update','OWN',NULL,'2026-07-28 22:54:19.392'),(34,'expense','delete','OWN',NULL,'2026-07-28 22:54:19.400'),(35,'account','read','OWN',NULL,'2026-07-28 22:54:19.407'),(36,'account','create','OWN',NULL,'2026-07-28 22:54:19.415'),(37,'account','update','OWN',NULL,'2026-07-28 22:54:19.422'),(38,'account','delete','OWN',NULL,'2026-07-28 22:54:19.430'),(39,'shopify_connection','create','ANY',NULL,'2026-07-28 23:19:39.592'),(40,'shopify_connection','create','OWN',NULL,'2026-07-28 23:19:39.604'),(41,'shopify_connection','read','ANY',NULL,'2026-07-28 23:19:39.611'),(42,'shopify_connection','read','OWN',NULL,'2026-07-28 23:19:39.617'),(43,'shopify_connection','delete','ANY',NULL,'2026-07-28 23:19:39.622'),(44,'shopify_connection','delete','OWN',NULL,'2026-07-28 23:19:39.628');
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `role_permissions`
--

DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `role_id` int NOT NULL,
  `permission_id` int NOT NULL,
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `role_permissions_permission_id_fkey` (`permission_id`),
  CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `role_permissions`
--

LOCK TABLES `role_permissions` WRITE;
/*!40000 ALTER TABLE `role_permissions` DISABLE KEYS */;
INSERT INTO `role_permissions` VALUES (1,1),(2,1),(1,2),(2,2),(1,3),(2,3),(1,4),(2,4),(1,5),(2,5),(1,6),(2,6),(1,7),(2,7),(1,8),(2,8),(1,9),(2,9),(1,10),(2,10),(1,11),(2,11),(1,12),(2,12),(1,13),(2,13),(1,14),(2,14),(1,15),(2,15),(1,16),(2,16),(1,17),(2,17),(1,18),(2,18),(1,19),(2,19),(1,20),(2,20),(1,21),(2,21),(1,22),(2,22),(1,23),(2,23),(1,24),(2,24),(1,25),(2,25),(1,26),(2,26),(1,27),(2,27),(1,28),(2,28),(1,29),(2,29),(1,30),(2,30),(1,31),(2,31),(1,32),(2,32),(1,33),(2,33),(1,34),(2,34),(1,35),(2,35),(1,36),(2,36),(1,37),(2,37),(1,38),(2,38),(1,39),(2,39),(1,40),(2,40),(1,41),(2,41),(1,42),(2,42),(1,43),(2,43),(1,44),(2,44);
/*!40000 ALTER TABLE `role_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_name_key` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (1,'admin','Administrador del sistema',1,'2026-07-28 22:29:31.740'),(2,'user','Usuario estandar',1,'2026-07-28 22:29:31.740');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shopify_connections`
--

DROP TABLE IF EXISTS `shopify_connections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopify_connections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `shop_domain` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_id` int NOT NULL,
  `access_token` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('ACTIVE','REVOKED','ERROR') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `installed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_synced_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `shopify_connections_shop_domain_key` (`shop_domain`),
  KEY `shopify_connections_user_id_idx` (`user_id`),
  KEY `shopify_connections_account_id_fkey` (`account_id`),
  CONSTRAINT `shopify_connections_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `shopify_connections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shopify_connections`
--

LOCK TABLES `shopify_connections` WRITE;
/*!40000 ALTER TABLE `shopify_connections` DISABLE KEYS */;
/*!40000 ALTER TABLE `shopify_connections` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shopify_orders`
--

DROP TABLE IF EXISTS `shopify_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopify_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `shopify_connection_id` int NOT NULL,
  `external_order_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_number` int NOT NULL,
  `items_total` double NOT NULL,
  `shopify_order_total` double DEFAULT NULL,
  `discount_total` double NOT NULL,
  `tax_total` double NOT NULL,
  `cost_total` double NOT NULL,
  `profit_total` double NOT NULL,
  `has_missing_cost_data` tinyint(1) NOT NULL DEFAULT '0',
  `line_items` json NOT NULL,
  `synced_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `shopify_orders_shopify_connection_id_external_order_id_key` (`shopify_connection_id`,`external_order_id`),
  CONSTRAINT `shopify_orders_shopify_connection_id_fkey` FOREIGN KEY (`shopify_connection_id`) REFERENCES `shopify_connections` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shopify_orders`
--

LOCK TABLES `shopify_orders` WRITE;
/*!40000 ALTER TABLE `shopify_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `shopify_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `taxes`
--

DROP TABLE IF EXISTS `taxes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `taxes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rate` double NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `taxes`
--

LOCK TABLES `taxes` WRITE;
/*!40000 ALTER TABLE `taxes` DISABLE KEYS */;
INSERT INTO `taxes` VALUES (1,'IVA 21%',21,'2026-07-28 22:01:52.016'),(3,'IVA 10%',10,'2026-07-28 22:01:52.016'),(4,'IVA 4%',4,'2026-07-28 22:14:20.675');
/*!40000 ALTER TABLE `taxes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo_url` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_token_id` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `locale` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'es',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `role_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`),
  KEY `users_role_id_fkey` (`role_id`),
  CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'test@example.com','secret123','Test User',NULL,NULL,'es','2026-07-28 19:14:32.514',2),(2,'second@example.com','pass456','Second User',NULL,NULL,'es','2026-07-28 19:15:28.180',2),(3,'nowpublic@example.com','pass789','No Token Needed',NULL,NULL,'es','2026-07-28 19:16:14.066',2),(4,'test@test.com','password123','Test',NULL,NULL,'es','2026-07-28 21:59:16.421',1),(5,'test2@test.com','test123','Test2',NULL,NULL,'es','2026-07-28 22:02:05.063',2),(6,'leak@test.com','visible123',NULL,NULL,NULL,'es','2026-07-28 22:22:32.567',2),(8,'other@test.com','x','Other',NULL,NULL,'es','2026-07-28 22:25:25.956',2),(9,'regular@test.com','pw','Regular',NULL,NULL,'es','2026-07-28 22:47:57.026',2),(10,'newuser@test.com','pw123','New',NULL,NULL,'es','2026-07-28 22:48:29.439',2),(12,'alice@test.com','alice',NULL,NULL,NULL,'es','2026-07-28 22:58:37.896',2),(13,'bob@test.com','bob',NULL,NULL,NULL,'es','2026-07-28 22:58:37.915',2),(14,'contract-test@paldex.dev','test1234','Contract Test',NULL,NULL,'es','2026-07-28 23:56:56.523',2),(16,'christiancorza@gmail.com','Edoten17','Chris',NULL,NULL,'es','2026-07-29 05:39:40.092',2);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'paldex'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-30  0:25:49
