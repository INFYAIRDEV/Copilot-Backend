// import { prisma } from "../../shared/utils/prismaClient.js";
// import { logger } from "../../shared/utils/logger.js";

// /**
//  * Initializes the curated reporting schema and AdventureWorks reporting views
//  * as specified in Section 4 of the System Design document:
//  * - reporting.v_sales
//  * - reporting.v_customer
//  * - reporting.v_product
//  * - reporting.v_territory
//  * - reporting.v_salesperson
//  */
// export async function initializeReportingSchema(): Promise<void> {
//   try {
//     await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS reporting;`);

//     await prisma.$executeRawUnsafe(`
//       CREATE TABLE IF NOT EXISTS reporting.sales_territory (
//         territory_id INT PRIMARY KEY,
//         territory_name VARCHAR(50) NOT NULL,
//         country_region VARCHAR(50) NOT NULL,
//         group_name VARCHAR(50) NOT NULL
//       );
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE TABLE IF NOT EXISTS reporting.product (
//         product_id INT PRIMARY KEY,
//         product_name VARCHAR(100) NOT NULL,
//         category VARCHAR(50) NOT NULL,
//         list_price NUMERIC(12, 2) NOT NULL
//       );
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE TABLE IF NOT EXISTS reporting.customer (
//         customer_id INT PRIMARY KEY,
//         customer_name VARCHAR(100) NOT NULL,
//         territory VARCHAR(50) NOT NULL,
//         account_number VARCHAR(20) NOT NULL
//       );
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE TABLE IF NOT EXISTS reporting.salesperson (
//         salesperson_id INT PRIMARY KEY,
//         name VARCHAR(100) NOT NULL,
//         territory VARCHAR(50) NOT NULL
//       );
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE TABLE IF NOT EXISTS reporting.sales_order_line (
//         order_id INT NOT NULL,
//         line_id INT NOT NULL,
//         order_date DATE NOT NULL,
//         customer_id INT NOT NULL,
//         customer_name VARCHAR(100) NOT NULL,
//         product_id INT NOT NULL,
//         product_name VARCHAR(100) NOT NULL,
//         category VARCHAR(50) NOT NULL,
//         territory VARCHAR(50) NOT NULL,
//         salesperson VARCHAR(100) NOT NULL,
//         quantity INT NOT NULL,
//         unit_price NUMERIC(12, 2) NOT NULL,
//         discount NUMERIC(12, 2) NOT NULL,
//         sales_amount NUMERIC(14, 2) NOT NULL,
//         PRIMARY KEY (order_id, line_id)
//       );
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE OR REPLACE VIEW reporting.v_territory AS
//       SELECT territory_id, territory_name, country_region, group_name
//       FROM reporting.sales_territory;
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE OR REPLACE VIEW reporting.v_product AS
//       SELECT product_id, product_name, category, list_price
//       FROM reporting.product;
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE OR REPLACE VIEW reporting.v_customer AS
//       SELECT customer_id, customer_name, territory, account_number
//       FROM reporting.customer;
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE OR REPLACE VIEW reporting.v_salesperson AS
//       SELECT salesperson_id, name, territory
//       FROM reporting.salesperson;
//     `);

//     await prisma.$executeRawUnsafe(`
//       CREATE OR REPLACE VIEW reporting.v_sales AS
//       SELECT
//         order_id,
//         order_date,
//         customer_id,
//         customer_name,
//         product_id,
//         product_name,
//         category,
//         territory,
//         salesperson,
//         quantity,
//         unit_price,
//         discount,
//         sales_amount
//       FROM reporting.sales_order_line;
//     `);

//     logger.info("Reporting schema and views verified.");
//   } catch (err: any) {
//     logger.error("Failed to initialize reporting schema:", err);
//     throw err;
//   }
// }
