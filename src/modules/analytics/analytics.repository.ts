import { prisma } from "@/shared/utils/prismaClient.js";
import { logger } from "@/shared/utils/logger.js";
import {
  SALES_TRANSACTION_FACTS,
  SUPPLIER_TRANSACTION_FACTS,
  SALES_ORDER_DELAY_LINES,
  PRODUCTION_ORDER_DELAY_FACTS,
  ALLOCATION_FACTS,
  GOLDEN_VALIDATION_CHECKS,
  QUERY_CATALOG,
  SalesTransactionFact,
  SupplierTransactionFact,
  SalesOrderDelayLine,
  ProductionOrderDelayFact,
  AllocationFact,
} from "./analytics.fixtures.js";

function normalizeFixtureWindow(val: string | null | undefined): "Q3-CURRENT" | "Q2-46D" | "PY-46D" {
  if (!val) return "Q3-CURRENT";
  const upper = String(val).toUpperCase();
  if (upper.includes("Q3_2026") || upper.includes("CURRENT")) return "Q3-CURRENT";
  if (upper.includes("Q2_2026") || upper.includes("Q2")) return "Q2-46D";
  if (upper.includes("2025") || upper.includes("PY")) return "PY-46D";
  return "Q3-CURRENT";
}

export class AnalyticsRepository {
  private isDbAvailable: boolean | null = null;
  private isLiveDb: boolean = false;
  private lastDbCheckTime = 0;
  private readonly DB_CHECK_INTERVAL_MS = 60000; // recheck every 1 minute

  public isDatabaseActive(): boolean {
    return this.isLiveDb;
  }

  public getDataSourceLabel(): string {
    return this.isLiveDb
      ? "PostgreSQL database views (analytics schema)"
      : "Synthetic demonstration data (fallback)";
  }

  public async canConnectDb(): Promise<boolean> {
    const now = Date.now();
    if (this.isDbAvailable !== null && now - this.lastDbCheckTime < this.DB_CHECK_INTERVAL_MS) {
      return this.isDbAvailable;
    }

    try {
      // Probe with 8 second timeout for remote SSL handshake
      await Promise.race([
        prisma.$queryRawUnsafe("SELECT 1;"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 8000)),
      ]);
      this.isDbAvailable = true;
      this.lastDbCheckTime = now;
      logger.info(
        "[AnalyticsRepository] Remote PostgreSQL database connected. Serving queries from analytics schema views.",
      );
      return true;
    } catch {
      this.isDbAvailable = false;
      this.lastDbCheckTime = now;
      logger.warn(
        "[AnalyticsRepository] Remote PostgreSQL database unreachable. Operating in governed Track A certified fixture mode.",
      );
      return false;
    }
  }

  /**
   * Fetches sales transactions from analytics.v_sales_transaction_fact
   */
  async getSalesTransactions(): Promise<SalesTransactionFact[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            transaction_id,
            posting_at,
            transaction_type,
            customer_id,
            customer_code,
            customer_name,
            currency,
            net_amount,
            fixture_window
          FROM analytics.v_sales_transaction_fact
          ORDER BY posting_at ASC;
        `);
        if (rows && rows.length > 0) {
          this.isLiveDb = true;
          return rows.map((r) => ({
            transaction_id: r.transaction_id,
            posting_at: r.posting_at instanceof Date ? r.posting_at.toISOString() : String(r.posting_at),
            transaction_type: r.transaction_type,
            customer_id: r.customer_id,
            customer_code: r.customer_code,
            customer_name: r.customer_name,
            currency: r.currency,
            net_amount: Number(r.net_amount),
            fixture_window: normalizeFixtureWindow(r.fixture_window),
          }));
        }
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying v_sales_transaction_fact: ${err.message}`);
      }
    }
    return SALES_TRANSACTION_FACTS;
  }

  /**
   * Fetches supplier transactions from analytics.v_supplier_transaction_fact
   */
  async getSupplierTransactions(): Promise<SupplierTransactionFact[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            transaction_id,
            posting_at,
            transaction_type,
            supplier_id,
            supplier_code,
            supplier_name,
            currency,
            net_amount
          FROM analytics.v_supplier_transaction_fact
          ORDER BY posting_at ASC;
        `);
        if (rows && rows.length > 0) {
          this.isLiveDb = true;
          return rows.map((r) => ({
            transaction_id: r.transaction_id,
            posting_at: r.posting_at instanceof Date ? r.posting_at.toISOString() : String(r.posting_at),
            transaction_type: r.transaction_type,
            supplier_id: r.supplier_id,
            supplier_code: r.supplier_code,
            supplier_name: r.supplier_name,
            currency: r.currency,
            net_amount: Number(r.net_amount),
          }));
        }
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying v_supplier_transaction_fact: ${err.message}`);
      }
    }
    return SUPPLIER_TRANSACTION_FACTS;
  }

  /**
   * Fetches delayed sales order lines from analytics.v_sales_order_delay_current
   */
  async getSalesOrderDelayLines(): Promise<SalesOrderDelayLine[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            sales_order_id,
            sales_order_line_id,
            customer_id,
            customer_code,
            customer_name,
            order_state,
            open_qty,
            unit_net_price,
            currency,
            approved_commitment,
            remaining_net_value,
            is_delayed
          FROM analytics.v_sales_order_delay_current
          WHERE is_delayed = TRUE
          ORDER BY sales_order_id, sales_order_line_id;
        `);
        if (rows && rows.length > 0) {
          this.isLiveDb = true;
          return rows.map((r) => ({
            sales_order_id: r.sales_order_id,
            sales_order_line_id: r.sales_order_line_id,
            customer_id: r.customer_id,
            customer_code: r.customer_code,
            customer_name: r.customer_name,
            order_state: r.order_state,
            open_qty: Number(r.open_qty),
            unit_net_price: Number(r.unit_net_price),
            currency: r.currency,
            approved_commitment: r.approved_commitment instanceof Date ? r.approved_commitment.toISOString().split("T")[0] : String(r.approved_commitment),
            remaining_net_value: Number(r.remaining_net_value),
            is_delayed: Boolean(r.is_delayed),
          }));
        }
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying v_sales_order_delay_current: ${err.message}`);
      }
    }
    return SALES_ORDER_DELAY_LINES.filter((l) => l.is_delayed);
  }

  /**
   * Fetches production delay orders from analytics.v_production_order_delay_current
   */
  async getProductionOrderDelayFacts(): Promise<ProductionOrderDelayFact[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            production_order_id,
            order_state,
            required_good_qty,
            accepted_good_qty,
            approved_cancelled_qty,
            remaining_required_good_qty,
            governing_finish,
            target_source,
            is_delayed
          FROM analytics.v_production_order_delay_current
          WHERE is_delayed = TRUE
          ORDER BY production_order_id;
        `);
        if (rows && rows.length > 0) {
          this.isLiveDb = true;
          return rows.map((r) => ({
            production_order_id: r.production_order_id,
            order_state: r.order_state,
            required_good_qty: Number(r.required_good_qty),
            accepted_good_qty: Number(r.accepted_good_qty),
            approved_cancelled_qty: Number(r.approved_cancelled_qty),
            remaining_required_good_qty: Number(r.remaining_required_good_qty),
            governing_finish: r.governing_finish instanceof Date ? r.governing_finish.toISOString() : String(r.governing_finish),
            target_source: r.target_source,
            is_delayed: Boolean(r.is_delayed),
          }));
        }
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying v_production_order_delay_current: ${err.message}`);
      }
    }
    return PRODUCTION_ORDER_DELAY_FACTS.filter((p) => p.is_delayed);
  }

  /**
   * Fetches allocations from analytics.v_sales_production_allocation_current
   */
  async getAllocations(): Promise<AllocationFact[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT
            allocation_id,
            sales_order_line_id,
            production_order_id,
            allocation_weight,
            delayed_line_backlog_value,
            allocated_backlog_value,
            customer_id,
            customer_code,
            customer_name
          FROM analytics.v_sales_production_allocation_current
          ORDER BY sales_order_line_id, production_order_id;
        `);
        if (rows && rows.length > 0) {
          this.isLiveDb = true;
          return rows.map((r) => ({
            allocation_id: String(r.allocation_id),
            sales_order_line_id: r.sales_order_line_id,
            production_order_id: r.production_order_id,
            allocation_weight: Number(r.allocation_weight),
            open_value_eur: Number(r.delayed_line_backlog_value),
            allocated_backlog_value: Number(r.allocated_backlog_value),
            customer_id: r.customer_id,
            customer_code: r.customer_code,
            customer_name: r.customer_name,
          }));
        }
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying v_sales_production_allocation_current: ${err.message}`);
      }
    }
    return ALLOCATION_FACTS;
  }

  /**
   * Fetches golden validation checks from analytics_demo.v_golden_validation
   */
  async getGoldenValidation(): Promise<any[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT * FROM analytics_demo.v_golden_validation;
        `);
        return rows;
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying v_golden_validation: ${err.message}`);
      }
    }
    return GOLDEN_VALIDATION_CHECKS;
  }

  /**
   * Fetches the 6 approved demonstrator journeys from analytics_demo.query_catalog
   */
  async getQueryCatalog(): Promise<any[]> {
    if (await this.canConnectDb()) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT journey_no, query_id, display_name, operation_type, lifecycle_state
          FROM analytics_demo.query_catalog
          ORDER BY journey_no;
        `);
        return rows;
      } catch (err: any) {
        logger.error(`[AnalyticsRepository] Error querying query_catalog: ${err.message}`);
      }
    }
    return QUERY_CATALOG;
  }
}

export const analyticsRepository = new AnalyticsRepository();
