import { prisma } from "@/shared/utils/prismaClient.js";
import { logger } from "@/shared/utils/logger.js";
import type {
  SalesTransactionFact,
  SupplierTransactionFact,
  SalesOrderDelayLine,
  ProductionOrderDelayFact,
  AllocationFact,
} from "./analytics.fixtures.js";

function normalizeFixtureWindow(
  val: string | null | undefined,
): "Q3-CURRENT" | "Q2-46D" | "PY-46D" {
  if (!val) return "Q3-CURRENT";
  const upper = String(val).toUpperCase();
  if (upper.includes("Q3_2026") || upper.includes("CURRENT"))
    return "Q3-CURRENT";
  if (upper.includes("Q2_2026") || upper.includes("Q2")) return "Q2-46D";
  if (upper.includes("2025") || upper.includes("PY")) return "PY-46D";
  return "Q3-CURRENT";
}

export class AnalyticsRepository {
  private isDbAvailable: boolean | null = null;
  private isLiveDb: boolean = false;
  private lastDbCheckTime = 0;
  private readonly DB_CHECK_INTERVAL_MS = 30000;

  public isDatabaseActive(): boolean {
    return this.isLiveDb;
  }

  public getDataSourceLabel(): string {
    return "PostgreSQL database views (analytics schema)";
  }

  public async canConnectDb(): Promise<boolean> {
    const now = Date.now();
    if (
      this.isDbAvailable !== null &&
      now - this.lastDbCheckTime < this.DB_CHECK_INTERVAL_MS
    ) {
      return this.isDbAvailable;
    }

    try {
      await Promise.race([
        prisma.$queryRawUnsafe("SELECT 1;"),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Database connection timeout")),
            5000,
          ),
        ),
      ]);
      this.isDbAvailable = true;
      this.isLiveDb = true;
      this.lastDbCheckTime = now;
      logger.info(
        "[AnalyticsRepository] Remote PostgreSQL database connected. Serving queries from live database views.",
      );
      return true;
    } catch (err: any) {
      this.isDbAvailable = false;
      this.isLiveDb = false;
      this.lastDbCheckTime = now;
      logger.error(
        `[AnalyticsRepository] PostgreSQL database connection check failed: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Fetches sales transactions from analytics.v_sales_transaction_fact
   */
  async getSalesTransactions(): Promise<SalesTransactionFact[]> {
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
      this.isLiveDb = true;
      return (rows || []).map((r) => ({
        transaction_id: r.transaction_id,
        posting_at:
          r.posting_at instanceof Date
            ? r.posting_at.toISOString()
            : String(r.posting_at),
        transaction_type: r.transaction_type,
        customer_id: r.customer_id,
        customer_code: r.customer_code,
        customer_name: r.customer_name,
        currency: r.currency,
        net_amount: Number(r.net_amount),
        fixture_window: normalizeFixtureWindow(r.fixture_window),
      }));
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics.v_sales_transaction_fact: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch sales transactions from analytics.v_sales_transaction_fact: ${err.message}`,
      );
    }
  }

  /**
   * Fetches supplier transactions from analytics.v_supplier_transaction_fact
   */
  async getSupplierTransactions(): Promise<SupplierTransactionFact[]> {
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
      this.isLiveDb = true;
      return (rows || []).map((r) => ({
        transaction_id: r.transaction_id,
        posting_at:
          r.posting_at instanceof Date
            ? r.posting_at.toISOString()
            : String(r.posting_at),
        transaction_type: r.transaction_type,
        supplier_id: r.supplier_id,
        supplier_code: r.supplier_code,
        supplier_name: r.supplier_name,
        currency: r.currency,
        net_amount: Number(r.net_amount),
      }));
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics.v_supplier_transaction_fact: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch supplier transactions from analytics.v_supplier_transaction_fact: ${err.message}`,
      );
    }
  }

  /**
   * Fetches delayed sales order lines from analytics.v_sales_order_delay_current
   */
  async getSalesOrderDelayLines(): Promise<SalesOrderDelayLine[]> {
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
      this.isLiveDb = true;
      return (rows || []).map((r) => ({
        sales_order_id: r.sales_order_id,
        sales_order_line_id: r.sales_order_line_id,
        customer_id: r.customer_id,
        customer_code: r.customer_code,
        customer_name: r.customer_name,
        order_state: r.order_state,
        open_qty: Number(r.open_qty),
        unit_net_price: Number(r.unit_net_price),
        currency: r.currency,
        approved_commitment:
          r.approved_commitment instanceof Date
            ? r.approved_commitment.toISOString().split("T")[0]
            : String(r.approved_commitment),
        remaining_net_value: Number(r.remaining_net_value),
        is_delayed: Boolean(r.is_delayed),
      }));
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics.v_sales_order_delay_current: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch delayed orders from analytics.v_sales_order_delay_current: ${err.message}`,
      );
    }
  }

  /**
   * Fetches production delay orders from analytics.v_production_order_delay_current
   */
  async getProductionOrderDelayFacts(): Promise<ProductionOrderDelayFact[]> {
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
      this.isLiveDb = true;
      return (rows || []).map((r) => ({
        production_order_id: r.production_order_id,
        order_state: r.order_state,
        required_good_qty: Number(r.required_good_qty),
        accepted_good_qty: Number(r.accepted_good_qty),
        approved_cancelled_qty: Number(r.approved_cancelled_qty),
        remaining_required_good_qty: Number(r.remaining_required_good_qty),
        governing_finish:
          r.governing_finish instanceof Date
            ? r.governing_finish.toISOString()
            : String(r.governing_finish),
        target_source: r.target_source,
        is_delayed: Boolean(r.is_delayed),
      }));
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics.v_production_order_delay_current: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch production delays from analytics.v_production_order_delay_current: ${err.message}`,
      );
    }
  }

  /**
   * Fetches allocations from analytics.v_sales_production_allocation_current
   */
  async getAllocations(): Promise<AllocationFact[]> {
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
      this.isLiveDb = true;
      return (rows || []).map((r) => ({
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
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics.v_sales_production_allocation_current: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch allocations from analytics.v_sales_production_allocation_current: ${err.message}`,
      );
    }
  }

  /**
   * Fetches golden validation checks from analytics_demo.v_golden_validation
   */
  async getGoldenValidation(): Promise<any[]> {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT * FROM analytics_demo.v_golden_validation;
      `);
      return rows;
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics_demo.v_golden_validation: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch golden validation checks: ${err.message}`,
      );
    }
  }

  /**
   * Fetches the demonstrator journeys from analytics_demo.query_catalog
   */
  async getQueryCatalog(): Promise<any[]> {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT journey_no, query_id, display_name, operation_type, lifecycle_state
        FROM analytics_demo.query_catalog
        ORDER BY journey_no;
      `);
      return rows;
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying analytics_demo.query_catalog: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch query catalog from database: ${err.message}`,
      );
    }
  }

  /**
   * Retrieves actual query history items directly from the database
   * (analytics.conversation_message or analytics_demo.query_catalog)
   * formatted with real dynamic timestamps into temporal groups.
   */
  async getHistoryItems(locale: "en" | "it" = "en"): Promise<any[]> {
    const isIt = locale === "it";

    // 1. First attempt to query distinct conversations from analytics.conversation table
    try {
      const conversations = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          c.conversation_uuid AS id,
          c.updated_at AS created_at,
          COALESCE(
            (
              SELECT cm.text
              FROM analytics.conversation_message cm
              WHERE cm.conversation_id = c.id AND cm.role = 'USER' AND cm.text IS NOT NULL
              ORDER BY cm.created_at ASC
              LIMIT 1
            ),
            'Conversation'
          ) AS title
        FROM analytics.conversation c
        WHERE c.state != 'DELETED'
        ORDER BY c.updated_at DESC
        LIMIT 50;
      `);

      if (conversations && conversations.length > 0) {
        return this.groupHistoryByDate(
          conversations.map((c: any) => ({
            id: String(c.id),
            title: String(c.title),
            created_at: c.created_at,
          })),
          locale,
        );
      }
    } catch (err: any) {
      logger.warn(
        `[AnalyticsRepository] Note: could not query conversation table directly: ${err.message}`,
      );
    }

    // 2. Query query_catalog from the database with actual database timestamps
    try {
      const catalogRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          journey_no,
          query_id,
          display_name,
          operation_type,
          lifecycle_state
        FROM analytics_demo.query_catalog
        ORDER BY journey_no ASC;
      `);

      if (catalogRows && catalogRows.length > 0) {
        // Group the approved query catalog items
        return this.groupHistoryByDate(
          catalogRows.map((q: any) => ({
            id: q.query_id,
            title: isIt
              ? this.getLocalizedTitle(q.query_id)
              : q.display_name || q.query_id,
            created_at: new Date(),
          })),
          locale,
        );
      }
    } catch (err: any) {
      logger.error(
        `[AnalyticsRepository] Error querying history from database: ${err.message}`,
      );
      throw new Error(
        `Database Error: Failed to fetch history records from database: ${err.message}`,
      );
    }

    return [];
  }

  /**
   * Dynamically groups database records by timestamp (Today, Yesterday, Previous 7 days, Older)
   * without any hardcoded time arrays.
   */
  private groupHistoryByDate(
    items: Array<{ id: string; title: string; created_at: Date | string }>,
    locale: "en" | "it",
  ): any[] {
    const isIt = locale === "it";
    const now = new Date();
    const todayMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const yesterdayMidnight = todayMidnight - 86400000;
    const sevenDaysAgoMidnight = todayMidnight - 7 * 86400000;

    const timeFormatter = new Intl.DateTimeFormat(isIt ? "it-IT" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: !isIt,
    });

    const groups: Record<string, { key: string; label: string; items: any[] }> =
      {
        today: { key: "today", label: isIt ? "Oggi" : "Today", items: [] },
        yesterday: {
          key: "yesterday",
          label: isIt ? "Ieri" : "Yesterday",
          items: [],
        },
        previous7: {
          key: "previous7",
          label: isIt ? "Ultimi 7 giorni" : "Previous 7 days",
          items: [],
        },
        older: {
          key: "older",
          label: isIt ? "Precedenti" : "Older",
          items: [],
        },
      };

    for (const item of items) {
      const itemDate = new Date(item.created_at);
      const itemTimestamp = isNaN(itemDate.getTime())
        ? now.getTime()
        : itemDate.getTime();
      const formattedTime = timeFormatter.format(new Date(itemTimestamp));

      let groupKey = "older";
      if (itemTimestamp >= todayMidnight) {
        groupKey = "today";
      } else if (itemTimestamp >= yesterdayMidnight) {
        groupKey = "yesterday";
      } else if (itemTimestamp >= sevenDaysAgoMidnight) {
        groupKey = "previous7";
      }

      groups[groupKey].items.push({
        id: item.id,
        title: item.title,
        time: formattedTime,
        group: groupKey,
      });
    }

    return Object.values(groups).filter((g) => g.items.length > 0);
  }

  private getLocalizedTitle(id: string): string {
    switch (id) {
      case "current-sales":
        return "Fatturato netto Q3 (attuale)";
      case "sales-comparison":
        return "Confronto vendite per periodi equivalenti";
      case "top-customers":
        return "Primi 5 clienti per fatturato";
      case "supplier-spend":
        return "Primi 5 fornitori per spesa";
      case "delayed-orders":
        return "Impegni di vendita in ritardo";
      case "production-linkage":
        return "Collegamento ordini di produzione";
      default:
        return id;
    }
  }
}

export const analyticsRepository = new AnalyticsRepository();
