/**
 * Approved reporting schema catalog as specified in Section 4 of the System Design document.
 * The AI service does not discover database objects from scratch on every request.
 * It uses this versioned, memory-cached catalog.
 */

export interface CatalogColumn {
  type: string;
  description: string;
}

export interface CatalogView {
  grain: string;
  description: string;
  columns: Record<string, CatalogColumn>;
  allowed: boolean;
}

export const SCHEMA_CATALOG: Record<string, CatalogView> = {
  "reporting.v_sales": {
    grain: "one sales order line",
    description: "curated sales fact view for dynamic analytics",
    allowed: true,
    columns: {
      order_id: { type: "integer", description: "unique order identifier" },
      order_date: { type: "date", description: "date when sales order was placed (YYYY-MM-DD)" },
      customer_id: { type: "integer", description: "customer identifier" },
      customer_name: { type: "varchar", description: "display name of customer" },
      product_id: { type: "integer", description: "product identifier" },
      product_name: { type: "varchar", description: "name of the product" },
      category: { type: "varchar", description: "product category (Bikes, Components, Clothing, Accessories)" },
      territory: { type: "varchar", description: "normalized sales territory (e.g. Northwest, Southwest, Central, Canada, France, Germany, Australia, United Kingdom)" },
      salesperson: { type: "varchar", description: "assigned salesperson name" },
      quantity: { type: "integer", description: "number of units sold" },
      unit_price: { type: "decimal", description: "price per unit" },
      discount: { type: "decimal", description: "discount amount" },
      sales_amount: { type: "decimal", description: "net extended sales revenue after line discount" },
    },
  },
  "reporting.v_customer": {
    grain: "one customer",
    description: "curated customer dimension",
    allowed: true,
    columns: {
      customer_id: { type: "integer", description: "unique customer identifier" },
      customer_name: { type: "varchar", description: "display name of customer" },
      territory: { type: "varchar", description: "customer home territory" },
      account_number: { type: "varchar", description: "account code" },
    },
  },
  "reporting.v_product": {
    grain: "one product",
    description: "curated product dimension",
    allowed: true,
    columns: {
      product_id: { type: "integer", description: "unique product identifier" },
      product_name: { type: "varchar", description: "product name" },
      category: { type: "varchar", description: "product category" },
      list_price: { type: "decimal", description: "catalog list price" },
    },
  },
  "reporting.v_territory": {
    grain: "one territory",
    description: "curated territory dimension",
    allowed: true,
    columns: {
      territory_id: { type: "integer", description: "territory identifier" },
      territory_name: { type: "varchar", description: "territory name" },
      country_region: { type: "varchar", description: "country or region name" },
      group_name: { type: "varchar", description: "continental group (e.g. North America, Europe, Pacific)" },
    },
  },
  "reporting.v_salesperson": {
    grain: "one salesperson",
    description: "curated salesperson dimension",
    allowed: true,
    columns: {
      salesperson_id: { type: "integer", description: "salesperson identifier" },
      name: { type: "varchar", description: "salesperson full name" },
      territory: { type: "varchar", description: "primary territory" },
    },
  },
};

/**
 * Returns formatted schema prompt text for Gemini prompt injection.
 */
export function getSchemaCatalogPrompt(): string {
  const lines: string[] = [];
  lines.push("Approved PostgreSQL reporting views and columns (Schema: reporting):");

  for (const [viewName, def] of Object.entries(SCHEMA_CATALOG)) {
    if (!def.allowed) continue;
    lines.push(`\nView: ${viewName}`);
    lines.push(`  Description: ${def.description}`);
    lines.push(`  Grain: ${def.grain}`);
    lines.push(`  Columns:`);
    for (const [colName, col] of Object.entries(def.columns)) {
      lines.push(`    - ${colName} (${col.type}): ${col.description}`);
    }
  }

  return lines.join("\n");
}

/**
 * Verifies if a referenced table is in the allowed schema catalog.
 */
export function isTableAllowed(tableName: string): boolean {
  const normalized = tableName.toLowerCase().trim();
  const directMatch = SCHEMA_CATALOG[normalized]?.allowed === true;
  if (directMatch) return true;

  // Check without schema if schema is reporting
  const withSchema = normalized.startsWith("reporting.") ? normalized : `reporting.${normalized}`;
  return SCHEMA_CATALOG[withSchema]?.allowed === true;
}

/**
 * Verifies if all referenced tables are allowlisted.
 */
export function areTablesAllowed(tables: string[]): { allowed: boolean; rejectedTables: string[] } {
  const rejected: string[] = [];
  for (const t of tables) {
    if (!isTableAllowed(t)) {
      rejected.push(t);
    }
  }
  return {
    allowed: rejected.length === 0,
    rejectedTables: rejected,
  };
}
