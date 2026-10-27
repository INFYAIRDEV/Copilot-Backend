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
      order_line_id: { type: "integer", description: "unique line identifier within the order" },
      order_date: { type: "date", description: "date when sales order was placed (YYYY-MM-DD)" },
      due_date: { type: "date", description: "order due date (YYYY-MM-DD)" },
      ship_date: { type: "date", description: "order ship date (YYYY-MM-DD)" },
      order_status: { type: "smallint", description: "order status code (1=In process, 2=Approved, 3=Backordered, 4=Rejected, 5=Shipped, 6=Cancelled)" },
      online_order: { type: "boolean", description: "true if online order flag is set, false if offline/salesperson" },
      customer_id: { type: "integer", description: "customer identifier" },
      customer_name: { type: "varchar", description: "display name of customer" },
      customer_type: { type: "text", description: "customer type ('STORE' or 'INDIVIDUAL')" },
      product_id: { type: "integer", description: "product identifier" },
      product_name: { type: "varchar", description: "name of the product" },
      product_subcategory: { type: "varchar", description: "product subcategory (e.g. Mountain Bikes, Road Frames, Jerseys)" },
      product_category: { type: "varchar", description: "product category (Bikes, Components, Clothing, Accessories)" },
      territory_id: { type: "integer", description: "sales territory identifier" },
      territory: { type: "varchar", description: "normalized sales territory (e.g. Northwest, Southwest, Central, Canada, France, Germany, Australia, United Kingdom)" },
      territory_country_code: { type: "varchar", description: "country or region code (e.g. US, CA, FR, DE, AU, GB)" },
      territory_group: { type: "varchar", description: "continental territory group (e.g. North America, Europe, Pacific)" },
      salesperson_id: { type: "integer", description: "salesperson identifier" },
      salesperson_name: { type: "text", description: "assigned salesperson full name" },
      quantity: { type: "integer", description: "number of units sold" },
      unit_price: { type: "decimal", description: "price per unit" },
      discount: { type: "decimal", description: "discount amount" },
      gross_amount: { type: "decimal", description: "gross sales amount before discount" },
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
      customer_type: { type: "text", description: "customer type ('STORE' or 'INDIVIDUAL')" },
      person_id: { type: "integer", description: "person identifier" },
      store_id: { type: "integer", description: "store identifier" },
      territory_id: { type: "integer", description: "customer territory identifier" },
      territory: { type: "varchar", description: "customer home territory" },
      country_region_code: { type: "varchar", description: "country or region code" },
      territory_group: { type: "varchar", description: "territory group name" },
    },
  },
  "reporting.v_product": {
    grain: "one product",
    description: "curated product dimension",
    allowed: true,
    columns: {
      product_id: { type: "integer", description: "unique product identifier" },
      product_number: { type: "varchar", description: "product catalog number" },
      product_name: { type: "varchar", description: "product name" },
      product_subcategory_id: { type: "integer", description: "product subcategory identifier" },
      product_subcategory: { type: "varchar", description: "product subcategory name" },
      product_category_id: { type: "integer", description: "product category identifier" },
      product_category: { type: "varchar", description: "product category (Bikes, Components, Clothing, Accessories)" },
      color: { type: "varchar", description: "product color" },
      size: { type: "varchar", description: "product size" },
      standard_cost: { type: "decimal", description: "standard manufacturing cost" },
      list_price: { type: "decimal", description: "catalog list price" },
      product_line: { type: "varchar", description: "product line code" },
      class: { type: "varchar", description: "product class code" },
      style: { type: "varchar", description: "product style code" },
      finished_goods: { type: "boolean", description: "finished goods flag" },
      sell_start_date: { type: "date", description: "date product was first sold" },
      sell_end_date: { type: "date", description: "date product was retired" },
      discontinued_date: { type: "date", description: "date product was discontinued" },
    },
  },
  "reporting.v_territory": {
    grain: "one territory",
    description: "curated territory dimension",
    allowed: true,
    columns: {
      territory_id: { type: "integer", description: "territory identifier" },
      territory_name: { type: "varchar", description: "territory name" },
      country_region_code: { type: "varchar", description: "country or region code" },
      territory_group: { type: "varchar", description: "continental group (e.g. North America, Europe, Pacific)" },
      sales_ytd: { type: "decimal", description: "year-to-date sales" },
      sales_last_year: { type: "decimal", description: "prior year sales" },
      cost_ytd: { type: "decimal", description: "year-to-date cost" },
      cost_last_year: { type: "decimal", description: "prior year cost" },
    },
  },
  "reporting.v_salesperson": {
    grain: "one salesperson",
    description: "curated salesperson dimension",
    allowed: true,
    columns: {
      salesperson_id: { type: "integer", description: "salesperson identifier" },
      salesperson_name: { type: "text", description: "salesperson full name" },
      territory_id: { type: "integer", description: "assigned territory identifier" },
      territory_name: { type: "varchar", description: "assigned territory name" },
      country_region_code: { type: "varchar", description: "country or region code" },
      territory_group: { type: "varchar", description: "territory group name" },
      sales_quota: { type: "decimal", description: "sales quota target" },
      bonus: { type: "decimal", description: "bonus amount" },
      commission_pct: { type: "decimal", description: "commission percentage" },
      sales_ytd: { type: "decimal", description: "year-to-date sales total" },
      sales_last_year: { type: "decimal", description: "prior year sales total" },
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
