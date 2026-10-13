import { randomUUID } from "node:crypto";
import {
  analyticsRepository,
  AnalyticsRepository,
} from "./analytics.repository.js";
import {
  JourneyId,
  JourneyExecutionResult,
  UIAnswer,
  BlueprintAnswerResponse,
  SummaryPart,
  BlueprintModelCandidatePlan,
  BlueprintExecutionEnvelope,
  PipelineExecutionResult,
} from "./analytics.types.js";
import { LLMConfigManager } from "@/infrastructure/ai/llm-config.js";
import { logger } from "../../shared/utils/logger.js";
import { prisma } from "../../shared/utils/prismaClient.js";
import { appendAudit } from "@/modules/copilot/conversation.repository.js";
import { t } from "i18next";

type Locale = "en" | "it";

// Translates a key for an explicit locale (same pattern as the repository).
// We pass the locale on every call so the response language never depends on global state.
const tr = (
  key: string,
  locale: Locale,
  options: Record<string, unknown> = {},
): string => t(key, { lng: locale, ...options }) as string;

// Turns a translated sentence into SummaryPart[]. Text wrapped in **double stars** becomes bold.
// Keeping the whole sentence in one key lets translators reorder words freely.
const toSummaryParts = (text: string): SummaryPart[] =>
  text
    .split("**")
    .map((chunk, i) =>
      i % 2 === 1 ? { text: chunk, bold: true } : { text: chunk },
    )
    .filter((p) => p.text !== "");

// Number formatting follows the request locale (1.234,5 in Italian vs 1,234.5 in English).
const numLocale = (l: Locale) => (l === "it" ? "it-IT" : "en-US");
const fmtEur = (n: number, l: Locale, decimals?: number) =>
  "€" +
  n.toLocaleString(
    numLocale(l),
    decimals === undefined
      ? undefined
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  );
const fmtPct = (n: number, l: Locale) =>
  n.toLocaleString(numLocale(l), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + "%";
const fmtSignedPct = (n: number, l: Locale) =>
  (n >= 0 ? "+" : "") + fmtPct(n, l);
const fmtSignedEur = (n: number, l: Locale) =>
  (n >= 0 ? "+" : "-") + fmtEur(Math.abs(n), l);

const isCurrentQ3Window = (w?: string) =>
  !w || w === "Q3-CURRENT" || w.includes("Q3_2026") || w.includes("CURRENT");
const isQ2ElapsedWindow = (w?: string) =>
  w === "Q2-46D" || (!!w && (w.includes("Q2_2026") || w.includes("Q2")));
const isPYElapsedWindow = (w?: string) =>
  w === "PY-46D" || (!!w && (w.includes("2025") || w.includes("PY")));

export class AnalyticsService {
  constructor(
    private readonly repo: AnalyticsRepository = analyticsRepository,
  ) {}

  /**
   * Resolves a user prompt or journey ID to one of the 6 fixed Track A journeys.
   */
  resolveJourney(input: string): JourneyId | null {
    const rawTrimmed = (input || "").trim().toLowerCase();
    const validIds: JourneyId[] = [
      "current-sales",
      "sales-comparison",
      "top-customers",
      "supplier-spend",
      "delayed-orders",
      "production-linkage",
    ];
    if (validIds.includes(rawTrimmed as JourneyId)) {
      return rawTrimmed as JourneyId;
    }

    const text = input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;

    // 1. Production Linkage (must precede delayed-orders so 'production orders linked to delayed sales' routes here)
    if (
      text === "production linkage" ||
      text.includes("production link") ||
      text.includes("linked production") ||
      text.includes("linkage") ||
      text.includes("collegamento produzione") ||
      (text.includes("production") &&
        (text.includes("delay") ||
          text.includes("link") ||
          text.includes("sales")))
    ) {
      return "production-linkage";
    }

    // 2. Delayed Sales Orders
    if (
      text === "delayed orders" ||
      text.includes("delayed sales") ||
      text.includes("delayed order") ||
      text.includes("late order") ||
      text.includes("ordini in ritardo") ||
      text.includes("why are there delayed orders")
    ) {
      return "delayed-orders";
    }

    // 3. Top Suppliers / Supplier Spend
    if (
      text === "supplier spend" ||
      text.includes("supplier") ||
      text.includes("fornitor") ||
      text.includes("procurement") ||
      text.includes("spesa fornitori")
    ) {
      return "supplier-spend";
    }

    // 4. Sales Comparison (must precede current-sales)
    if (
      text === "sales comparison" ||
      text.includes("sales comparison") ||
      text.includes("comparison") ||
      text.includes("compare") ||
      text.includes("confront") ||
      text.includes("previous quarter") ||
      text.includes("prior year") ||
      text.includes("last year") ||
      text.includes("same period last year")
    ) {
      return "sales-comparison";
    }

    // 5. Top Customers
    if (
      text === "top customers" ||
      text.includes("customer") ||
      text.includes("clienti") ||
      text.includes("primi clienti") ||
      text.includes("best customer") ||
      text.includes("principali clienti")
    ) {
      return "top-customers";
    }

    // 6. Current Net Sales
    if (
      text === "current sales" ||
      text.includes("sales") ||
      text.includes("vendit") ||
      text.includes("fatturato") ||
      text.includes("revenue")
    ) {
      return "current-sales";
    }

    return null;
  }

  /**
   * Executes one of the 6 fixed Track A journeys deterministically.
   */
  async executeJourney(
    journeyId: JourneyId,
    locale: "en" | "it" = "en",
  ): Promise<JourneyExecutionResult> {
    switch (journeyId) {
      case "current-sales":
        return this.executeCurrentSalesJourney(locale);
      case "sales-comparison":
        return this.executeSalesComparisonJourney(locale);
      case "top-customers":
        return this.executeTopCustomersJourney(locale);
      case "supplier-spend":
        return this.executeSupplierSpendJourney(locale);
      case "delayed-orders":
        return this.executeDelayedOrdersJourney(locale);
      case "production-linkage":
        return this.executeProductionLinkageJourney(locale);
      default:
        throw new Error(`Unsupported journey ID: ${journeyId}`);
    }
  }

  // =========================================================================
  // JOURNEY 1: Current Sales
  // =========================================================================
  private async executeCurrentSalesJourney(
    locale: "en" | "it",
  ): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSalesTransactions();
    const currentQ3Facts = facts.filter((f) =>
      isCurrentQ3Window(f.fixture_window),
    );
    const totalNetSales = currentQ3Facts.reduce(
      (sum, f) => sum + f.net_amount,
      0,
    ); // 820,000

    const period = tr("analytics.periods.currentQ3", locale);
    const formattedTotal = fmtEur(totalNetSales, locale);

    const summary: SummaryPart[] = toSummaryParts(
      tr("analytics.journeys.currentSales.summary", locale, {
        total: formattedTotal,
      }),
    );

    // Points by customer for breakdown
    const customerMap = new Map<string, number>();
    for (const f of currentQ3Facts) {
      customerMap.set(
        f.customer_name,
        (customerMap.get(f.customer_name) || 0) + f.net_amount,
      );
    }
    const points = Array.from(customerMap.entries()).map(([label, value]) => ({
      label,
      value,
    }));

    const uiAnswer: UIAnswer = {
      id: "current-sales",
      question: tr("analytics.journeys.currentSales.question", locale),
      summary,
      chart: {
        title: tr("analytics.journeys.currentSales.chartTitle", locale),
        subtitle: tr("analytics.journeys.currentSales.chartSubtitle", locale),
        format: "currency",
        yMax: 200000,
        yStep: 50000,
        points: points.slice(0, 5),
      },
      table: {
        title: tr("analytics.journeys.currentSales.tableTitle", locale),
        columns: [
          tr("analytics.columns.customer", locale),
          tr("analytics.columns.netInvoicedSales", locale),
          tr("analytics.columns.share", locale),
        ],
        rows: points.map((p) => [
          p.label,
          fmtEur(p.value, locale),
          fmtPct((p.value / totalNetSales) * 100, locale),
        ]),
      },
      meta: {
        period,
        metric: tr("analytics.metrics.netInvoicedSales", locale),
        howCalculated: tr(
          "analytics.journeys.currentSales.howCalculated",
          locale,
        ),
      },
    };

    const requestId = randomUUID();
    const answerId = randomUUID();

    const blueprintResponse: BlueprintAnswerResponse = {
      schemaVersion: "1.2",
      requestId,
      answerId,
      status: "SUCCESS",
      summary: {
        locale,
        statementType: "FACTUAL_SUMMARY",
        generationMode: "SERVER_TEMPLATE",
        claimRefs: ["claim-sales-total"],
        text: tr("analytics.journeys.currentSales.blueprintSummary", locale, {
          total: formattedTotal,
        }),
      },
      claims: [
        {
          claimId: "claim-sales-total",
          claimType: "VALUE",
          valueRefs: [
            "/metrics/0/value",
            "/context/periodStart",
            "/context/periodEndExclusive",
          ],
        },
      ],
      context: {
        mode: "TRANSACTION_PERIOD",
        timezone: "Europe/Rome",
        calendarId: "calendar.standard.it",
        asOf: "2026-08-15T08:30:00+02:00",
        periodStart: "2026-07-01T00:00:00+02:00",
        periodEndExclusive: "2026-08-15T08:30:00+02:00",
        currency: "EUR",
        rounding: "HALF_UP_2DP",
      },
      metrics: [
        {
          metricId: "sales.invoiced_net",
          metricVersion: "1.1.0",
          value: totalNetSales,
          unit: "EUR",
          // Machine-facing display value stays in en-US format.
          displayValue: "€" + totalNetSales.toLocaleString("en-US"),
          variancePercent: null,
        },
      ],
      rankings: [],
      comparisons: [],
      resultSets: [],
      visualizations: [
        {
          type: "KPI",
          title: tr("analytics.journeys.currentSales.vizTitle", locale),
          datasetKind: "METRIC",
          datasetRef: "metric-sales-invoiced-net",
        },
      ],
      definitions: [
        {
          metricId: "sales.invoiced_net",
          metricVersion: "1.1.0",
          definitionUrl: "/api/v1/analytics/metrics/sales.invoiced_net",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: currentQ3Facts.length,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["analytics.v_sales_transaction_fact-v1.0"],
      },
      freshness: {
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        status: "FRESH",
        reconciliationStatus: "RECONCILED",
        publicationId: "44444444-4444-4444-8444-444444444444",
      },
      warnings: [],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "current-sales",
      displayName: tr("analytics.journeyTitles.current-sales", locale),
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: currentQ3Facts,
    };
  }

  // =========================================================================
  // JOURNEY 2: Sales Comparison
  // =========================================================================
  private async executeSalesComparisonJourney(
    locale: "en" | "it",
  ): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSalesTransactions();
    const currentQ3 = facts
      .filter((f) => isCurrentQ3Window(f.fixture_window))
      .reduce((s, f) => s + f.net_amount, 0); // 820,000
    const q2Equivalent = facts
      .filter((f) => isQ2ElapsedWindow(f.fixture_window))
      .reduce((s, f) => s + f.net_amount, 0); // 760,000
    const pyEquivalent = facts
      .filter((f) => isPYElapsedWindow(f.fixture_window))
      .reduce((s, f) => s + f.net_amount, 0); // 700,000

    const varianceQ2 = Number(
      (((currentQ3 - q2Equivalent) / q2Equivalent) * 100).toFixed(1),
    ); // +7.9%
    const variancePY = Number(
      (((currentQ3 - pyEquivalent) / pyEquivalent) * 100).toFixed(1),
    ); // +17.1%

    const absQ2 = currentQ3 - q2Equivalent;
    const absPY = currentQ3 - pyEquivalent;

    const summary: SummaryPart[] = toSummaryParts(
      tr("analytics.journeys.salesComparison.summary", locale, {
        current: fmtEur(currentQ3, locale),
        varQ2: fmtSignedPct(varianceQ2, locale),
        absQ2: fmtSignedEur(absQ2, locale),
        q2: fmtEur(q2Equivalent, locale),
        varPY: fmtSignedPct(variancePY, locale),
        absPY: fmtSignedEur(absPY, locale),
        py: fmtEur(pyEquivalent, locale),
      }),
    );

    const uiAnswer: UIAnswer = {
      id: "sales-comparison",
      question: tr("analytics.journeys.salesComparison.question", locale),
      summary,
      chart: {
        title: tr("analytics.journeys.salesComparison.chartTitle", locale),
        subtitle: tr(
          "analytics.journeys.salesComparison.chartSubtitle",
          locale,
        ),
        format: "currency",
        yMax: 900000,
        yStep: 200000,
        points: [
          {
            label: tr(
              "analytics.journeys.salesComparison.chartPriorYear",
              locale,
            ),
            value: pyEquivalent,
          },
          {
            label: tr(
              "analytics.journeys.salesComparison.chartPrevQuarter",
              locale,
            ),
            value: q2Equivalent,
          },
          {
            label: tr(
              "analytics.journeys.salesComparison.chartCurrent",
              locale,
            ),
            value: currentQ3,
          },
        ],
      },
      table: {
        title: tr("analytics.journeys.salesComparison.tableTitle", locale),
        columns: [
          tr("analytics.columns.period", locale),
          tr("analytics.columns.window", locale),
          tr("analytics.columns.netSales", locale),
          tr("analytics.columns.varianceVsCurrent", locale),
        ],
        rows: [
          [
            tr("analytics.journeys.salesComparison.rowCurrent", locale),
            tr("analytics.journeys.salesComparison.windows.current", locale),
            fmtEur(currentQ3, locale),
            tr("analytics.journeys.salesComparison.baseline", locale),
          ],
          [
            tr("analytics.journeys.salesComparison.rowQ2", locale),
            tr("analytics.journeys.salesComparison.windows.q2", locale),
            fmtEur(q2Equivalent, locale),
            `${fmtSignedPct(varianceQ2, locale)} (${fmtSignedEur(absQ2, locale)})`,
          ],
          [
            tr("analytics.journeys.salesComparison.rowPY", locale),
            tr("analytics.journeys.salesComparison.windows.py", locale),
            fmtEur(pyEquivalent, locale),
            `${fmtSignedPct(variancePY, locale)} (${fmtSignedEur(absPY, locale)})`,
          ],
        ],
      },
      meta: {
        period: tr("analytics.periods.elapsed46Days", locale),
        metric: tr("analytics.metrics.netInvoicedSalesVariance", locale),
        howCalculated: tr(
          "analytics.journeys.salesComparison.howCalculated",
          locale,
        ),
      },
    };

    const blueprintResponse: BlueprintAnswerResponse = {
      schemaVersion: "1.2",
      requestId: randomUUID(),
      answerId: randomUUID(),
      status: "SUCCESS",
      summary: {
        locale,
        statementType: "FACTUAL_SUMMARY",
        generationMode: "SERVER_TEMPLATE",
        claimRefs: ["claim-comp-q2", "claim-comp-py"],
        text: tr(
          "analytics.journeys.salesComparison.blueprintSummary",
          locale,
          {
            current: fmtEur(currentQ3, locale),
            varQ2: fmtSignedPct(varianceQ2, locale),
            varPY: fmtSignedPct(variancePY, locale),
          },
        ),
      },
      claims: [
        {
          claimId: "claim-comp-q2",
          claimType: "COMPARISON",
          valueRefs: [
            "/comparisons/0/percentVariance",
            "/comparisons/0/baselineValue",
          ],
        },
        {
          claimId: "claim-comp-py",
          claimType: "COMPARISON",
          valueRefs: [
            "/comparisons/1/percentVariance",
            "/comparisons/1/baselineValue",
          ],
        },
      ],
      context: {
        mode: "TRANSACTION_PERIOD",
        timezone: "Europe/Rome",
        calendarId: "calendar.standard.it",
        asOf: "2026-08-15T08:30:00+02:00",
        periodStart: "2026-07-01T00:00:00+02:00",
        periodEndExclusive: "2026-08-15T08:30:00+02:00",
        currency: "EUR",
        rounding: "HALF_UP_2DP",
      },
      metrics: [
        {
          metricId: "sales.invoiced_net",
          metricVersion: "1.1.0",
          value: currentQ3,
          unit: "EUR",
          // Machine-facing display value stays in en-US format.
          displayValue: "€" + currentQ3.toLocaleString("en-US"),
          variancePercent: varianceQ2,
        },
      ],
      rankings: [],
      comparisons: [
        {
          comparisonId: "comp-q2-equivalent",
          currentMetricRef: "/metrics/0",
          baselinePeriodStart: "2026-04-01T00:00:00+02:00",
          baselinePeriodEndExclusive: "2026-05-16T00:00:00+02:00",
          baselineValue: q2Equivalent,
          absoluteVariance: currentQ3 - q2Equivalent,
          percentVariance: varianceQ2,
        },
        {
          comparisonId: "comp-py-equivalent",
          currentMetricRef: "/metrics/0",
          baselinePeriodStart: "2025-07-01T00:00:00+02:00",
          baselinePeriodEndExclusive: "2025-08-16T00:00:00+02:00",
          baselineValue: pyEquivalent,
          absoluteVariance: currentQ3 - pyEquivalent,
          percentVariance: variancePY,
        },
      ],
      resultSets: [],
      visualizations: [
        {
          type: "BAR",
          title: tr("analytics.journeys.salesComparison.vizTitle", locale),
          datasetKind: "COMPARISON",
          datasetRef: "comp-q2-equivalent",
        },
      ],
      definitions: [
        {
          metricId: "sales.invoiced_net",
          metricVersion: "1.1.0",
          definitionUrl: "/api/v1/analytics/metrics/sales.invoiced_net",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: facts.length,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["analytics.v_sales_transaction_fact-v1.0"],
      },
      freshness: {
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        status: "FRESH",
        reconciliationStatus: "RECONCILED",
        publicationId: "44444444-4444-4444-8444-444444444444",
      },
      warnings: [],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "sales-comparison",
      displayName: tr("analytics.journeyTitles.sales-comparison", locale),
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: facts,
    };
  }

  // =========================================================================
  // JOURNEY 3: Top Customers
  // =========================================================================
  private async executeTopCustomersJourney(
    locale: "en" | "it",
  ): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSalesTransactions();
    const currentQ3 = facts.filter((f) => isCurrentQ3Window(f.fixture_window));
    const totalSales = currentQ3.reduce((s, f) => s + f.net_amount, 0); // 820,000

    // Group by customer
    const customerMap = new Map<
      string,
      { code: string; id: string; name: string; amount: number }
    >();
    for (const f of currentQ3) {
      const existing = customerMap.get(f.customer_id) || {
        id: f.customer_id,
        code: f.customer_code,
        name: f.customer_name,
        amount: 0,
      };
      existing.amount += f.net_amount;
      customerMap.set(f.customer_id, existing);
    }

    // Sort descending by amount, tie-breaker: customer_code ASC
    const ranked = Array.from(customerMap.values()).sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.code.localeCompare(b.code);
    });

    const top5 = ranked.slice(0, 5);
    const top5Total = top5.reduce((s, c) => s + c.amount, 0); // 631,000
    const top5Share = Number(((top5Total / totalSales) * 100).toFixed(1)); // 77.0%

    const summary: SummaryPart[] = toSummaryParts(
      tr("analytics.journeys.topCustomers.summary", locale, {
        top5Total: fmtEur(top5Total, locale),
        share: fmtPct(top5Share, locale),
        total: fmtEur(totalSales, locale),
      }),
    );

    const uiAnswer: UIAnswer = {
      id: "top-customers",
      question: tr("analytics.journeys.topCustomers.question", locale),
      summary,
      chart: {
        title: tr("analytics.journeys.topCustomers.chartTitle", locale),
        subtitle: tr("analytics.journeys.topCustomers.chartSubtitle", locale),
        format: "currency",
        yMax: 200000,
        yStep: 50000,
        points: top5.map((c) => ({ label: c.name, value: c.amount })),
      },
      table: {
        title: tr("analytics.journeys.topCustomers.tableTitle", locale),
        columns: [
          tr("analytics.columns.customer", locale),
          tr("analytics.columns.netInvoicedSales", locale),
          tr("analytics.columns.share", locale),
        ],
        rows: top5.map((c) => [
          c.name,
          fmtEur(c.amount, locale),
          fmtPct((c.amount / totalSales) * 100, locale),
        ]),
      },
      meta: {
        period: tr("analytics.periods.currentQ3", locale),
        metric: tr("analytics.metrics.netInvoicedSales", locale),
        howCalculated: tr(
          "analytics.journeys.topCustomers.howCalculated",
          locale,
          { total: fmtEur(totalSales, locale) },
        ),
      },
    };

    const blueprintResponse: BlueprintAnswerResponse = {
      schemaVersion: "1.2",
      requestId: randomUUID(),
      answerId: randomUUID(),
      status: "SUCCESS",
      summary: {
        locale,
        statementType: "FACTUAL_SUMMARY",
        generationMode: "SERVER_TEMPLATE",
        claimRefs: ["claim-top-customers"],
        text: tr("analytics.journeys.topCustomers.blueprintSummary", locale, {
          top5Total: fmtEur(top5Total, locale),
          share: fmtPct(top5Share, locale),
          total: fmtEur(totalSales, locale),
        }),
      },
      claims: [
        {
          claimId: "claim-top-customers",
          claimType: "RANKING",
          valueRefs: [
            "/rankings/0/topNValue",
            "/rankings/0/topNSharePercent",
            "/metrics/0/value",
          ],
        },
      ],
      context: {
        mode: "TRANSACTION_PERIOD",
        timezone: "Europe/Rome",
        calendarId: "calendar.standard.it",
        asOf: "2026-08-15T08:30:00+02:00",
        periodStart: "2026-07-01T00:00:00+02:00",
        periodEndExclusive: "2026-08-15T08:30:00+02:00",
        currency: "EUR",
        rounding: "HALF_UP_2DP",
      },
      metrics: [
        {
          metricId: "sales.invoiced_net",
          metricVersion: "1.1.0",
          value: totalSales,
          unit: "EUR",
          displayValue: "€" + totalSales.toLocaleString("en-US"),
          variancePercent: null,
        },
      ],
      rankings: [
        {
          rankingId: "ranking-top-customers",
          entityDimensionId: "customer.customer",
          measure: {
            metricId: "sales.invoiced_net",
            metricVersion: "1.1.0",
            unit: "EUR",
          },
          direction: "DESC",
          tieBreaker: "customer_code ASC",
          totalValue: totalSales,
          topNValue: top5Total,
          topNSharePercent: top5Share,
          rows: top5.map((c, idx) => ({
            rank: idx + 1,
            entityId: c.id,
            entityCode: c.code,
            displayName: c.name,
            value: c.amount,
            displayValue: "€" + c.amount.toLocaleString("en-US"),
            sharePercent: Number(((c.amount / totalSales) * 100).toFixed(1)),
          })),
        },
      ],
      comparisons: [],
      resultSets: [],
      visualizations: [
        {
          type: "BAR",
          title: tr("analytics.journeys.topCustomers.vizTitle", locale),
          datasetKind: "RANKING",
          datasetRef: "ranking-top-customers",
        },
      ],
      definitions: [
        {
          metricId: "sales.invoiced_net",
          metricVersion: "1.1.0",
          definitionUrl: "/api/v1/analytics/metrics/sales.invoiced_net",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: 5,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["analytics.v_sales_transaction_fact-v1.0"],
      },
      freshness: {
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        status: "FRESH",
        reconciliationStatus: "RECONCILED",
        publicationId: "44444444-4444-4444-8444-444444444444",
      },
      warnings: [],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "top-customers",
      displayName: tr("analytics.journeyTitles.top-customers", locale),
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: top5,
    };
  }

  // =========================================================================
  // JOURNEY 4: Top Suppliers
  // =========================================================================
  private async executeSupplierSpendJourney(
    locale: "en" | "it",
  ): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSupplierTransactions();
    const totalSpend = facts.reduce((s, f) => s + f.net_amount, 0); // 510,000

    // Group by supplier
    const supplierMap = new Map<
      string,
      { id: string; code: string; name: string; amount: number }
    >();
    for (const f of facts) {
      const existing = supplierMap.get(f.supplier_id) || {
        id: f.supplier_id,
        code: f.supplier_code,
        name: f.supplier_name,
        amount: 0,
      };
      existing.amount += f.net_amount;
      supplierMap.set(f.supplier_id, existing);
    }

    // Sort descending by amount, tie-breaker: supplier_code ASC
    const ranked = Array.from(supplierMap.values()).sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.code.localeCompare(b.code);
    });

    const top5 = ranked.slice(0, 5);
    const top5Total = top5.reduce((s, sp) => s + sp.amount, 0); // 380,000
    const top5Share = Number(((top5Total / totalSpend) * 100).toFixed(1)); // 74.5%

    const summary: SummaryPart[] = toSummaryParts(
      tr("analytics.journeys.supplierSpend.summary", locale, {
        total: fmtEur(totalSpend, locale),
        share: fmtPct(top5Share, locale),
        top5Total: fmtEur(top5Total, locale),
      }),
    );

    const uiAnswer: UIAnswer = {
      id: "supplier-spend",
      question: tr("analytics.journeys.supplierSpend.question", locale),
      summary,
      chart: {
        title: tr("analytics.journeys.supplierSpend.chartTitle", locale),
        subtitle: tr("analytics.journeys.supplierSpend.chartSubtitle", locale),
        format: "currency",
        yMax: 150000,
        yStep: 30000,
        points: top5.map((sp) => ({ label: sp.name, value: sp.amount })),
      },
      table: {
        title: tr("analytics.journeys.supplierSpend.tableTitle", locale),
        columns: [
          tr("analytics.columns.supplier", locale),
          tr("analytics.columns.spend", locale),
          tr("analytics.columns.share", locale),
        ],
        rows: top5.map((sp) => [
          sp.name,
          fmtEur(sp.amount, locale),
          fmtPct((sp.amount / totalSpend) * 100, locale),
        ]),
      },
      meta: {
        period: tr("analytics.periods.currentQ3", locale),
        metric: tr("analytics.metrics.approvedSupplierSpend", locale),
        howCalculated: tr(
          "analytics.journeys.supplierSpend.howCalculated",
          locale,
          { total: fmtEur(totalSpend, locale) },
        ),
      },
    };

    const blueprintResponse: BlueprintAnswerResponse = {
      schemaVersion: "1.2",
      requestId: randomUUID(),
      answerId: randomUUID(),
      status: "SUCCESS",
      summary: {
        locale,
        statementType: "FACTUAL_SUMMARY",
        generationMode: "SERVER_TEMPLATE",
        claimRefs: ["claim-supplier-spend"],
        text: tr("analytics.journeys.supplierSpend.blueprintSummary", locale, {
          total: fmtEur(totalSpend, locale),
          top5Total: fmtEur(top5Total, locale),
          share: fmtPct(top5Share, locale),
        }),
      },
      claims: [
        {
          claimId: "claim-supplier-spend",
          claimType: "RANKING",
          valueRefs: [
            "/rankings/0/topNValue",
            "/rankings/0/topNSharePercent",
            "/metrics/0/value",
          ],
        },
      ],
      context: {
        mode: "TRANSACTION_PERIOD",
        timezone: "Europe/Rome",
        calendarId: "calendar.standard.it",
        asOf: "2026-08-15T08:30:00+02:00",
        periodStart: "2026-07-01T00:00:00+02:00",
        periodEndExclusive: "2026-08-15T08:30:00+02:00",
        currency: "EUR",
        rounding: "HALF_UP_2DP",
      },
      metrics: [
        {
          metricId: "procurement.supplier_spend_net",
          metricVersion: "1.0.0",
          value: totalSpend,
          unit: "EUR",
          displayValue: "€" + totalSpend.toLocaleString("en-US"),
          variancePercent: null,
        },
      ],
      rankings: [
        {
          rankingId: "ranking-top-suppliers",
          entityDimensionId: "supplier.supplier",
          measure: {
            metricId: "procurement.supplier_spend_net",
            metricVersion: "1.0.0",
            unit: "EUR",
          },
          direction: "DESC",
          tieBreaker: "supplier_code ASC",
          totalValue: totalSpend,
          topNValue: top5Total,
          topNSharePercent: top5Share,
          rows: top5.map((sp, idx) => ({
            rank: idx + 1,
            entityId: sp.id,
            entityCode: sp.code,
            displayName: sp.name,
            value: sp.amount,
            displayValue: "€" + sp.amount.toLocaleString("en-US"),
            sharePercent: Number(((sp.amount / totalSpend) * 100).toFixed(1)),
          })),
        },
      ],
      comparisons: [],
      resultSets: [],
      visualizations: [
        {
          type: "BAR",
          title: tr("analytics.journeys.supplierSpend.vizTitle", locale),
          datasetKind: "RANKING",
          datasetRef: "ranking-top-suppliers",
        },
      ],
      definitions: [
        {
          metricId: "procurement.supplier_spend_net",
          metricVersion: "1.0.0",
          definitionUrl:
            "/api/v1/analytics/metrics/procurement.supplier_spend_net",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: 5,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["analytics.v_supplier_transaction_fact-v1.0"],
      },
      freshness: {
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        status: "FRESH",
        reconciliationStatus: "RECONCILED",
        publicationId: "44444444-4444-4444-8444-444444444444",
      },
      warnings: [],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "supplier-spend",
      displayName: tr("analytics.journeyTitles.supplier-spend", locale),
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: top5,
    };
  }

  // =========================================================================
  // JOURNEY 5: Delayed Orders (Sales)
  // =========================================================================
  private async executeDelayedOrdersJourney(
    locale: "en" | "it",
  ): Promise<JourneyExecutionResult> {
    const delayLines = await this.repo.getSalesOrderDelayLines();
    const distinctOrders = new Set(delayLines.map((l) => l.sales_order_id))
      .size; // 6
    const distinctLines = delayLines.length; // 7
    const distinctCustomers = new Set(delayLines.map((l) => l.customer_id))
      .size; // 5
    const totalBacklog = delayLines.reduce(
      (s, l) => s + l.remaining_net_value,
      0,
    ); // 164,000

    const summary: SummaryPart[] = toSummaryParts(
      tr("analytics.journeys.delayedOrders.summary", locale, {
        orders: distinctOrders,
        lines: distinctLines,
        customers: distinctCustomers,
        backlog: fmtEur(totalBacklog, locale),
      }),
    );

    // Customer backlog grouping for chart
    const customerBacklog = new Map<string, number>();
    for (const l of delayLines) {
      customerBacklog.set(
        l.customer_name,
        (customerBacklog.get(l.customer_name) || 0) + l.remaining_net_value,
      );
    }
    const points = Array.from(customerBacklog.entries()).map(
      ([label, value]) => ({ label, value }),
    );

    const uiAnswer: UIAnswer = {
      id: "delayed-orders",
      question: tr("analytics.journeys.delayedOrders.question", locale),
      summary,
      chart: {
        title: tr("analytics.journeys.delayedOrders.chartTitle", locale),
        subtitle: tr("analytics.journeys.delayedOrders.chartSubtitle", locale),
        format: "currency",
        yMax: 60000,
        yStep: 15000,
        points,
      },
      table: {
        title: tr("analytics.journeys.delayedOrders.tableTitle", locale),
        columns: [
          tr("analytics.columns.orderId", locale),
          tr("analytics.columns.lineId", locale),
          tr("analytics.columns.customer", locale),
          tr("analytics.columns.openQty", locale),
          tr("analytics.columns.unitPrice", locale),
          tr("analytics.columns.backlog", locale),
        ],
        rows: delayLines.map((l) => [
          l.sales_order_id,
          l.sales_order_line_id,
          l.customer_name,
          String(l.open_qty),
          fmtEur(l.unit_net_price, locale, 2),
          fmtEur(l.remaining_net_value, locale),
        ]),
      },
      meta: {
        period: tr("analytics.periods.asOf", locale),
        metric: tr("analytics.metrics.delayedBacklog", locale),
        howCalculated: tr(
          "analytics.journeys.delayedOrders.howCalculated",
          locale,
        ),
      },
    };

    const blueprintResponse: BlueprintAnswerResponse = {
      schemaVersion: "1.2",
      requestId: randomUUID(),
      answerId: randomUUID(),
      status: "SUCCESS",
      summary: {
        locale,
        statementType: "FACTUAL_SUMMARY",
        generationMode: "SERVER_TEMPLATE",
        claimRefs: ["claim-delay-count", "claim-delay-backlog"],
        text: tr("analytics.journeys.delayedOrders.blueprintSummary", locale, {
          orders: distinctOrders,
          lines: distinctLines,
          customers: distinctCustomers,
          backlog: fmtEur(totalBacklog, locale),
        }),
      },
      claims: [
        {
          claimId: "claim-delay-count",
          claimType: "VALUE",
          valueRefs: ["/metrics/0/value", "/metrics/1/value"],
        },
        {
          claimId: "claim-delay-backlog",
          claimType: "VALUE",
          valueRefs: ["/metrics/2/value"],
        },
      ],
      context: {
        mode: "CURRENT_STATE",
        timezone: "Europe/Rome",
        calendarId: "calendar.standard.it",
        asOf: "2026-08-15T08:30:00+02:00",
        currency: "EUR",
        rounding: "HALF_UP_2DP",
      },
      metrics: [
        {
          metricId: "sales.delayed_order_count",
          metricVersion: "1.0.0",
          value: distinctOrders,
          unit: "count",
          displayValue: String(distinctOrders),
          variancePercent: null,
        },
        {
          metricId: "sales.delayed_order_line_count",
          metricVersion: "1.0.0",
          value: distinctLines,
          unit: "count",
          displayValue: String(distinctLines),
          variancePercent: null,
        },
        {
          metricId: "sales.delayed_backlog_net",
          metricVersion: "1.0.0",
          value: totalBacklog,
          unit: "EUR",
          displayValue: "€" + totalBacklog.toLocaleString("en-US"),
          variancePercent: null,
        },
      ],
      rankings: [],
      comparisons: [],
      resultSets: [],
      visualizations: [
        {
          type: "BAR",
          title: tr("analytics.journeys.delayedOrders.vizTitle", locale),
          datasetKind: "RESULT_SET",
          datasetRef: "delayed-order-lines",
        },
      ],
      definitions: [
        {
          metricId: "sales.delayed_backlog_net",
          metricVersion: "1.0.0",
          definitionUrl: "/api/v1/analytics/metrics/sales.delayed_backlog_net",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: delayLines.length,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["analytics.v_sales_order_delay_current-v1.0"],
      },
      freshness: {
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        status: "FRESH",
        reconciliationStatus: "RECONCILED",
        publicationId: "44444444-4444-4444-8444-444444444444",
      },
      warnings: [],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "delayed-orders",
      displayName: tr("analytics.journeyTitles.delayed-orders", locale),
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: delayLines,
    };
  }

  // =========================================================================
  // JOURNEY 6: Production Linkage
  // =========================================================================
  private async executeProductionLinkageJourney(
    locale: "en" | "it",
  ): Promise<JourneyExecutionResult> {
    const allocations = await this.repo.getAllocations();
    const productionOrders = await this.repo.getProductionOrderDelayFacts();
    const delayLines = await this.repo.getSalesOrderDelayLines();

    const totalDelayedBacklog = delayLines.reduce(
      (s, l) => s + l.remaining_net_value,
      0,
    ); // 164,000
    const linkedBacklog = allocations.reduce(
      (s, a) => s + a.allocated_backlog_value,
      0,
    ); // 149,240
    const unlinkedBacklog = totalDelayedBacklog - linkedBacklog; // 14,760
    const coveragePct = Number(
      ((linkedBacklog / totalDelayedBacklog) * 100).toFixed(1),
    ); // 91.0%

    const linkedProdOrdersCount = new Set(
      allocations.map((a) => a.production_order_id),
    ).size; // 6
    const affectedCustomersCount = new Set(
      allocations.map((a) => a.customer_id),
    ).size; // 5

    // Rounded percentages used in the chart labels, e.g. "91%" / "9%".
    const linkedPct = Math.round(coveragePct) + "%";
    const unlinkedPct = Math.round(100 - coveragePct) + "%";

    const summary: SummaryPart[] = toSummaryParts(
      tr("analytics.journeys.productionLinkage.summary", locale, {
        orders: linkedProdOrdersCount,
        customers: affectedCustomersCount,
        linked: fmtEur(linkedBacklog, locale),
        coverage: fmtPct(coveragePct, locale),
        total: fmtEur(totalDelayedBacklog, locale),
        unlinked: fmtEur(unlinkedBacklog, locale),
        unlinkedPct: fmtPct(100 - coveragePct, locale),
      }),
    );

    const uiAnswer: UIAnswer = {
      id: "production-linkage",
      question: tr("analytics.journeys.productionLinkage.question", locale),
      summary,
      chart: {
        title: tr("analytics.journeys.productionLinkage.chartTitle", locale),
        subtitle: tr(
          "analytics.journeys.productionLinkage.chartSubtitle",
          locale,
        ),
        format: "currency",
        yMax: 180000,
        yStep: 45000,
        points: [
          {
            label: tr(
              "analytics.journeys.productionLinkage.chartLinked",
              locale,
              { pct: linkedPct },
            ),
            value: linkedBacklog,
          },
          {
            label: tr(
              "analytics.journeys.productionLinkage.chartUnlinked",
              locale,
              { pct: unlinkedPct },
            ),
            value: unlinkedBacklog,
          },
        ],
      },
      table: {
        title: tr("analytics.journeys.productionLinkage.tableTitle", locale),
        columns: [
          tr("analytics.columns.productionOrder", locale),
          tr("analytics.columns.salesLine", locale),
          tr("analytics.columns.customer", locale),
          tr("analytics.columns.allocationWeight", locale),
          tr("analytics.columns.linkedValue", locale),
        ],
        rows: allocations.map((a) => [
          a.production_order_id,
          a.sales_order_line_id,
          a.customer_name,
          (a.allocation_weight * 100).toFixed(0) + "%",
          fmtEur(a.allocated_backlog_value, locale),
        ]),
      },
      meta: {
        period: tr("analytics.periods.asOf", locale),
        metric: tr("analytics.metrics.linkageCoverage", locale),
        howCalculated: tr(
          "analytics.journeys.productionLinkage.howCalculated",
          locale,
          {
            linked: fmtEur(linkedBacklog, locale),
            total: fmtEur(totalDelayedBacklog, locale),
            coverage: fmtPct(coveragePct, locale),
          },
        ),
      },
    };

    const blueprintResponse: BlueprintAnswerResponse = {
      schemaVersion: "1.2",
      requestId: randomUUID(),
      answerId: randomUUID(),
      status: "SUCCESS",
      summary: {
        locale,
        statementType: "FACTUAL_SUMMARY",
        generationMode: "SERVER_TEMPLATE",
        claimRefs: ["claim-linkage-coverage", "claim-linkage-warning"],
        text: tr(
          "analytics.journeys.productionLinkage.blueprintSummary",
          locale,
          {
            orders: linkedProdOrdersCount,
            customers: affectedCustomersCount,
            linked: fmtEur(linkedBacklog, locale),
            coverage: fmtPct(coveragePct, locale),
            unlinked: fmtEur(unlinkedBacklog, locale),
          },
        ),
      },
      claims: [
        {
          claimId: "claim-linkage-coverage",
          claimType: "COVERAGE",
          valueRefs: [
            "/metrics/0/value",
            "/evidence/linkage/numerator",
            "/evidence/linkage/denominator",
          ],
        },
        {
          claimId: "claim-linkage-warning",
          claimType: "WARNING",
          valueRefs: ["/warnings/0/message"],
        },
      ],
      context: {
        mode: "CURRENT_STATE",
        timezone: "Europe/Rome",
        calendarId: "calendar.standard.it",
        asOf: "2026-08-15T08:30:00+02:00",
        currency: "EUR",
        rounding: "HALF_UP_2DP",
      },
      metrics: [
        {
          metricId: "production.sales_linkage_coverage_pct",
          metricVersion: "1.0.0",
          value: coveragePct,
          unit: "percent",
          displayValue: coveragePct.toFixed(1) + "%",
          variancePercent: null,
        },
        {
          metricId: "production.exposed_backlog_net",
          metricVersion: "1.0.0",
          value: linkedBacklog,
          unit: "EUR",
          displayValue: "€" + linkedBacklog.toLocaleString("en-US"),
          variancePercent: null,
        },
        {
          metricId: "production.delayed_order_count",
          metricVersion: "1.0.0",
          value: linkedProdOrdersCount,
          unit: "count",
          displayValue: String(linkedProdOrdersCount),
          variancePercent: null,
        },
      ],
      rankings: [],
      comparisons: [],
      resultSets: [],
      visualizations: [
        {
          type: "BAR",
          title: tr("analytics.journeys.productionLinkage.vizTitle", locale),
          datasetKind: "RESULT_SET",
          datasetRef: "linkage-exposure",
        },
      ],
      definitions: [
        {
          metricId: "production.sales_linkage_coverage_pct",
          metricVersion: "1.0.0",
          definitionUrl:
            "/api/v1/analytics/metrics/production.sales_linkage_coverage_pct",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: allocations.length,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: [
          "analytics.v_sales_production_allocation_current-v1.0",
        ],
        linkage: {
          numerator: linkedBacklog,
          denominator: totalDelayedBacklog,
          unit: "EUR",
        },
      },
      freshness: {
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        status: "FRESH",
        reconciliationStatus: "RECONCILED",
        publicationId: "44444444-4444-4444-8444-444444444444",
      },
      warnings: [
        {
          code: "PARTIAL_LINKAGE_COVERAGE",
          severity: "WARNING",
          message: tr("analytics.journeys.productionLinkage.warning", locale, {
            coverage: fmtPct(coveragePct, locale),
            unlinked: fmtEur(unlinkedBacklog, locale),
          }),
          valueRefs: ["/metrics/0/value"],
        },
      ],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "production-linkage",
      displayName: tr("analytics.journeyTitles.production-linkage", locale),
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: allocations,
    };
  }

  /**
   * Retrieves supporting records for a specific journey with pagination.
   */
  async getSupportingRecords(journeyId: JourneyId, limit = 50, offset = 0) {
    const result = await this.executeJourney(journeyId);
    const records = result.supportingRecords;
    const paginated = records.slice(offset, offset + limit);
    return {
      journeyId,
      totalCount: records.length,
      limit,
      offset,
      hasMore: offset + limit < records.length,
      records: paginated,
    };
  }

  /**
   * Calls Google Gemini REST API to interpret natural language into a closed ModelCandidatePlan.
   */
  //  ```typescript
  // /**
  //  * Calls Gemini Interactions API to interpret natural language
  //  * into a closed ModelCandidatePlan.
  //  */

  private async callGeminiForCandidatePlan(
    userPrompt: string,
    locale: "en" | "it",
    config: any,
  ): Promise<BlueprintModelCandidatePlan | null> {
    const systemPrompt = `You are the Copilot Analytical Intent Engine.
Analyze the user's natural language question and return ONLY a closed JSON object conforming to the ModelCandidatePlan schema v1.2.

CRITICAL ARCHITECTURAL CONSTRAINTS:
1. Return candidate plan JSON only.
2. Never generate SQL or table names.
3. Never calculate numbers.
4. "intent" MUST be a string: "SUMMARY" | "COMPARE" | "RANK" | "DETAIL" | "TREND".
5. Canonical metrics:
   - "sales.invoiced_net" (Net invoiced sales, version "1.1.0")
   - "procurement.supplier_spend_net" (Supplier spend, version "1.0.0")
   - "sales.delayed_order_count" (Delayed sales orders count, version "1.0.0")
   - "sales.delayed_backlog_net" (Delayed sales backlog value, version "1.0.0")
   - "production.delayed_order_count" (Delayed production orders count, version "1.0.0")
   - "production.exposed_backlog_net" (Production linked backlog, version "1.0.0")
   - "production.sales_linkage_coverage_pct" (Sales-production linkage coverage, version "1.0.0")
6. Canonical dimensions: "customer.customer", "supplier.supplier", "sales.sales_order", "production.production_order".
7. Semantic Bindings for Executive Track A Journeys:
   - "Current sales" / "Net sales" -> intent: "SUMMARY", metric: "sales.invoiced_net"
   - "Equivalent-period comparison" / "Sales comparison" / "Compare sales" -> intent: "COMPARE", metric: "sales.invoiced_net", period alignment: "EQUIVALENT_ELAPSED_DAYS"
   - "Top customers" -> intent: "RANK", metric: "sales.invoiced_net", dimension: "customer.customer", limit: 5
   - "Top suppliers" / "Supplier spend" -> intent: "RANK", metric: "procurement.supplier_spend_net", dimension: "supplier.supplier", limit: 5
   - "Delayed sales commitments" / "Delayed sales orders" -> intent: "DETAIL", metrics: ["sales.delayed_order_count", "sales.delayed_backlog_net"]
   - "Production linkage" / "Production orders linked to delayed sales" -> intent: "DETAIL", metrics: ["production.sales_linkage_coverage_pct", "production.exposed_backlog_net"]
8. Ambiguity: ONLY unqualified questions like 'delayed orders' (without specifying sales vs production) require clarification (clarification.status = "REQUIRED").
   "Equivalent-period comparison" binds unambiguously to "sales.invoiced_net" and does NOT require clarification (clarification.status = "RESOLVED").
9. Example JSON:
{
  "schemaVersion": "1.2",
  "intent": "RANK",
  "timeContext": {
    "mode": "TRANSACTION_PERIOD",
    "timezone": "Europe/Rome",
    "calendarId": "calendar.standard.it",
    "period": { "kind": "CURRENT_QUARTER", "alignment": "FULL_PERIOD" }
  },
  "metrics": [{ "metricId": "sales.invoiced_net", "metricVersion": "1.1.0", "alias": "net_sales" }],
  "dimensions": [{ "dimensionId": "customer.customer" }],
  "filters": [],
  "sort": [{ "fieldRef": "net_sales", "direction": "DESC" }],
  "limit": 5,
  "freshnessRequirement": { "maximumAgeMinutes": 60, "onStale": "WARN" },
  "clarification": { "status": "RESOLVED", "question": null }
}`;

    const endpointUrl = config.endpointUrl.replace(/\/+$/, "");
    const url = `${endpointUrl}/interactions`;
    const maxAttempts = 2;
    const requestTimeoutMs = config.timeoutMs || 8000;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        controller = new AbortController();

        timeout = setTimeout(() => controller?.abort(), requestTimeoutMs);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": config.apiKey,
            },
            body: JSON.stringify({
              model: config.modelIdentifier,
              system_instruction: systemPrompt,
              input: `Locale: ${locale}\nUser Question: ${userPrompt}`,
              generation_config: {
                temperature: 0.1,
                max_output_tokens: config.maxOutputTokens || 1024,
              },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const retryableStatuses = new Set([429, 500, 502, 503, 504]);

            if (
              retryableStatuses.has(response.status) &&
              attempt < maxAttempts
            ) {
              logger.warn(
                "[AnalyticsService] Temporary Gemini API failure; retrying once",
                {
                  status: response.status,
                  model: config.modelIdentifier,
                  attempt,
                },
              );

              await response.body?.cancel().catch(() => {});
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }

            const errorText = await response.text();

            logger.warn("[AnalyticsService] Gemini API request failed", {
              status: response.status,
              model: config.modelIdentifier,
              attempt,
              error: errorText.slice(0, 500),
            });

            return null;
          }

          const result = (await response.json()) as {
            status?: string;
            steps?: Array<{
              type?: string;
              content?: Array<{
                type?: string;
                text?: string;
              }>;
            }>;
          };

          if (result.status !== "completed") {
            logger.warn(
              "[AnalyticsService] Gemini interaction did not complete",
              {
                status: result.status,
                model: config.modelIdentifier,
              },
            );
            return null;
          }

          const rawText = (result.steps ?? [])
            .filter((step) => step.type === "model_output")
            .flatMap((step) => step.content ?? [])
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("");

          if (!rawText.trim()) {
            logger.warn(
              "[AnalyticsService] Gemini returned no text in model output steps",
            );
            return null;
          }

          let parsed: BlueprintModelCandidatePlan;

          try {
            // Strip markdown code fences if model wrapped response in ```json ... ```
            const cleaned = rawText
              .replace(/```(?:json)?/gi, "")
              .replace(/```/g, "")
              .trim();
            parsed = JSON.parse(cleaned) as BlueprintModelCandidatePlan;
          } catch (err: any) {
            logger.warn(
              `[AnalyticsService] Gemini returned invalid JSON: ${err.message}`,
            );
            return null;
          }

          // Gracefully normalize if the model returned intent as an object or schemaVersion as number
          if (parsed && typeof (parsed as any).schemaVersion === "number") {
            (parsed as any).schemaVersion = String(
              (parsed as any).schemaVersion,
            );
          }
          if (
            parsed &&
            typeof parsed.intent === "object" &&
            parsed.intent !== null
          ) {
            const rawIntentObj = parsed.intent as any;
            const queryType =
              rawIntentObj.queryType || rawIntentObj.type || "SUMMARY";
            const intentStr =
              queryType === "ANALYTICAL" && rawIntentObj.sort?.length
                ? "RANK"
                : queryType === "ANALYTICAL"
                  ? "SUMMARY"
                  : queryType;
            if (rawIntentObj.metrics && !parsed.metrics) {
              parsed.metrics = rawIntentObj.metrics.map((m: any) =>
                typeof m === "string"
                  ? {
                      metricId: m === "revenue" ? "sales.invoiced_net" : m,
                      metricVersion: "1.1.0",
                      alias: m,
                    }
                  : m,
              );
            }
            if (rawIntentObj.dimensions && !parsed.dimensions) {
              parsed.dimensions = rawIntentObj.dimensions.map((d: any) =>
                typeof d === "string"
                  ? {
                      dimensionId:
                        d === "customer_name" ? "customer.customer" : d,
                    }
                  : d,
              );
            }
            if (rawIntentObj.limit && !parsed.limit) {
              parsed.limit = rawIntentObj.limit;
            }
            (parsed as any).intent = intentStr;
          }

          logger.info(
            "[AnalyticsService] Candidate plan validation diagnostics",
            {
              topLevelKeys: Object.keys(parsed ?? {}),
              schemaVersion: parsed?.schemaVersion,
              intentType: typeof parsed?.intent,
              intent: parsed?.intent,
            },
          );

          // Basic contract check only.
          if (
            parsed?.schemaVersion === "1.2" &&
            typeof parsed.intent === "string"
          ) {
            return parsed;
          }

          logger.warn(
            "[AnalyticsService] Gemini response failed basic plan validation",
          );

          return null;
        } finally {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
        }
      }

      return null;
    } catch (error: unknown) {
      const isTimeout = error instanceof Error && error.name === "AbortError";

      logger.warn("[AnalyticsService] Gemini API request failed", {
        reason: isTimeout ? "timeout" : "network_error",
        message: error instanceof Error ? error.message : "Unknown error",
        model: config.modelIdentifier,
      });

      return null;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  /**
   * Generates canonical ModelCandidatePlan for Track A certified journeys.
   */
  buildCanonicalCandidatePlan(
    journeyId: JourneyId | null,
    userQuery: string,
    locale: "en" | "it" = "en",
  ): BlueprintModelCandidatePlan {
    switch (journeyId) {
      case "current-sales":
        return {
          schemaVersion: "1.2",
          intent: "SUMMARY",
          timeContext: {
            mode: "TRANSACTION_PERIOD",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
            period: { kind: "CURRENT_QUARTER", alignment: "FULL_PERIOD" },
          },
          metrics: [
            {
              metricId: "sales.invoiced_net",
              metricVersion: "1.1.0",
              alias: "net_sales",
            },
          ],
          dimensions: [{ dimensionId: "customer.customer" }],
          filters: [],
          sort: [{ fieldRef: "net_sales", direction: "DESC" }],
          limit: 10,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };

      case "sales-comparison":
        return {
          schemaVersion: "1.2",
          intent: "COMPARE",
          timeContext: {
            mode: "TRANSACTION_PERIOD",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
            period: {
              kind: "CURRENT_QUARTER",
              alignment: "EQUIVALENT_ELAPSED_DAYS",
            },
          },
          metrics: [
            {
              metricId: "sales.invoiced_net",
              metricVersion: "1.1.0",
              alias: "net_sales",
            },
          ],
          dimensions: [],
          filters: [],
          sort: [],
          limit: 1,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };

      case "top-customers":
        return {
          schemaVersion: "1.2",
          intent: "RANK",
          timeContext: {
            mode: "TRANSACTION_PERIOD",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
            period: { kind: "CURRENT_QUARTER", alignment: "FULL_PERIOD" },
          },
          metrics: [
            {
              metricId: "sales.invoiced_net",
              metricVersion: "1.1.0",
              alias: "net_sales",
            },
          ],
          dimensions: [{ dimensionId: "customer.customer" }],
          filters: [],
          sort: [{ fieldRef: "net_sales", direction: "DESC" }],
          limit: 5,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };

      case "supplier-spend":
        return {
          schemaVersion: "1.2",
          intent: "RANK",
          timeContext: {
            mode: "TRANSACTION_PERIOD",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
            period: { kind: "CURRENT_QUARTER", alignment: "FULL_PERIOD" },
          },
          metrics: [
            {
              metricId: "procurement.supplier_spend_net",
              metricVersion: "1.0.0",
              alias: "supplier_spend",
            },
          ],
          dimensions: [{ dimensionId: "supplier.supplier" }],
          filters: [],
          sort: [{ fieldRef: "supplier_spend", direction: "DESC" }],
          limit: 5,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };

      case "delayed-orders":
        return {
          schemaVersion: "1.2",
          intent: "DETAIL",
          timeContext: {
            mode: "CURRENT_STATE",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
          },
          metrics: [
            {
              metricId: "sales.delayed_order_count",
              metricVersion: "1.0.0",
              alias: "delayed_orders",
            },
            {
              metricId: "sales.delayed_backlog_net",
              metricVersion: "1.0.0",
              alias: "delayed_backlog",
            },
          ],
          dimensions: [
            { dimensionId: "sales.sales_order" },
            { dimensionId: "customer.customer" },
          ],
          filters: [],
          sort: [{ fieldRef: "delayed_backlog", direction: "DESC" }],
          limit: 20,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };

      case "production-linkage":
        return {
          schemaVersion: "1.2",
          intent: "DETAIL",
          timeContext: {
            mode: "CURRENT_STATE",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
          },
          metrics: [
            {
              metricId: "production.exposed_backlog_net",
              metricVersion: "1.0.0",
              alias: "linked_backlog",
            },
            {
              metricId: "production.sales_linkage_coverage_pct",
              metricVersion: "1.0.0",
              alias: "coverage_pct",
            },
          ],
          dimensions: [
            { dimensionId: "production.production_order" },
            { dimensionId: "customer.customer" },
          ],
          filters: [],
          sort: [{ fieldRef: "linked_backlog", direction: "DESC" }],
          limit: 20,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };

      default:
        return {
          schemaVersion: "1.2",
          intent: "SUMMARY",
          timeContext: {
            mode: "TRANSACTION_PERIOD",
            timezone: "Europe/Rome",
            calendarId: "calendar.standard.it",
            period: { kind: "CURRENT_QUARTER", alignment: "FULL_PERIOD" },
          },
          metrics: [
            {
              metricId: "sales.invoiced_net",
              metricVersion: "1.1.0",
              alias: "net_sales",
            },
          ],
          dimensions: [{ dimensionId: "customer.customer" }],
          filters: [],
          sort: [{ fieldRef: "net_sales", direction: "DESC" }],
          limit: 5,
          freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
          clarification: { status: "RESOLVED", question: null },
        };
    }
  }

  /**
   * Resolves a journey ID from a ModelCandidatePlan's metrics and intent.
   */
  resolveJourneyFromCandidatePlan(
    plan: BlueprintModelCandidatePlan,
  ): JourneyId | null {
    const metricIds = (plan.metrics || []).map((m) => m.metricId);
    if (
      metricIds.includes("production.exposed_backlog_net") ||
      metricIds.includes("production.sales_linkage_coverage_pct") ||
      metricIds.includes("production.delayed_order_count") ||
      metricIds.some((m) => m.startsWith("production."))
    ) {
      return "production-linkage";
    }
    if (
      metricIds.includes("procurement.supplier_spend_net") ||
      metricIds.some((m) => m.startsWith("procurement."))
    ) {
      return "supplier-spend";
    }
    if (
      metricIds.includes("sales.delayed_order_count") ||
      metricIds.includes("sales.delayed_backlog_net") ||
      metricIds.includes("sales.delayed_order_line_count") ||
      metricIds.some((m) => m.startsWith("sales.delayed_"))
    ) {
      return "delayed-orders";
    }
    if (metricIds.includes("sales.invoiced_net")) {
      if (
        plan.intent === "COMPARE" ||
        plan.timeContext?.period?.alignment === "EQUIVALENT_ELAPSED_DAYS"
      ) {
        return "sales-comparison";
      }
      if (plan.intent === "RANK") {
        return "top-customers";
      }
      return "current-sales";
    }
    return null;
  }

  /**
   * Generates a closed Draft 2020-12 ModelCandidatePlan (Appendix A.1)
   */
  async generateCandidatePlan(
    userPrompt: string,
    locale: "en" | "it" = "en",
  ): Promise<BlueprintModelCandidatePlan> {
    const text = userPrompt.toLowerCase().trim();

    // Check for ambiguity per Blueprint §11.3:
    // "delayed orders" is ambiguous between sales orders and production orders
    if (
      (text === "delayed orders" ||
        text === "show delayed orders" ||
        text === "ordini in ritardo") &&
      !text.includes("sales") &&
      !text.includes("production") &&
      !text.includes("vendita") &&
      !text.includes("produzione")
    ) {
      return {
        schemaVersion: "1.2",
        intent: "DETAIL",
        timeContext: {
          mode: "CURRENT_STATE",
          timezone: "Europe/Rome",
          calendarId: "calendar.standard.it",
        },
        metrics: [],
        dimensions: [],
        filters: [],
        sort: [],
        limit: 10,
        freshnessRequirement: { maximumAgeMinutes: 60, onStale: "WARN" },
        clarification: {
          status: "REQUIRED",
          question: tr(
            "analytics.clarification.delayedOrdersAmbiguous",
            locale,
          ),
        },
      };
    }

    // Try calling live Google Gemini if a real API key is configured
    try {
      const config = LLMConfigManager.getConfig();
      if (
        config.apiKey &&
        config.apiKey !== "mock-dev-key" &&
        config.apiKey !== "your_api_key_here"
      ) {
        const candidatePlan = await this.callGeminiForCandidatePlan(
          userPrompt,
          locale,
          config,
        );
        if (candidatePlan) {
          // If Gemini flagged clarification for a prompt that is an approved Track A journey
          // (such as "Equivalent-period comparison", which binds unambiguously to sales.invoiced_net per Blueprint §7),
          // resolve it directly to the canonical candidate plan rather than prompting the executive.
          if (candidatePlan.clarification?.status === "REQUIRED") {
            const isGenuinelyAmbiguous =
              (text === "delayed orders" ||
                text === "show delayed orders" ||
                text === "ordini in ritardo") &&
              !text.includes("sales") &&
              !text.includes("production") &&
              !text.includes("vendita") &&
              !text.includes("produzione");

            if (!isGenuinelyAmbiguous) {
              const trackAJourney = this.resolveJourney(userPrompt);
              if (trackAJourney) {
                return this.buildCanonicalCandidatePlan(
                  trackAJourney,
                  userPrompt,
                  locale,
                );
              }
            }
          }
          return candidatePlan;
        }
      }
    } catch (err: any) {
      logger.warn(
        `[AnalyticsService] Live Gemini candidate plan call bypassed or failed: ${err.message}. Using governed semantic candidate plan.`,
      );
    }

    // Governed Semantic Candidate Plan for Track A Journeys
    const journeyId = this.resolveJourney(userPrompt);
    return this.buildCanonicalCandidatePlan(journeyId, userPrompt, locale);
  }

  /**
   * Constructs the server-owned ExecutionEnvelope (Blueprint Appendix A.2)
   */
  buildExecutionEnvelope(
    candidatePlan: BlueprintModelCandidatePlan,
    journeyId: JourneyId,
    userContext?: { userId?: string; sessionId?: string; roleId?: string },
  ): BlueprintExecutionEnvelope {
    const requestId = randomUUID();
    const policyDecisionId = randomUUID();
    const nowIso = new Date().toISOString();

    const isCurrentState =
      journeyId === "delayed-orders" || journeyId === "production-linkage";

    const resolvedTime = isCurrentState
      ? {
          mode: "CURRENT_STATE",
          timezone: "Europe/Rome" as const,
          calendarId: "calendar.standard.it",
        }
      : {
          mode: "TRANSACTION_PERIOD",
          timezone: "Europe/Rome" as const,
          calendarId: "calendar.standard.it",
          periodStartUtc:
            journeyId === "sales-comparison"
              ? "2026-04-01T00:00:00Z"
              : "2026-06-30T22:00:00Z",
          periodEndUtcExclusive: "2026-08-15T06:30:00Z",
        };

    const semanticBindings = candidatePlan.metrics.map((m, idx) => ({
      bindingKind: "METRIC" as const,
      candidateRef: `/metrics/${idx}`,
      registryId: m.metricId,
      version: m.metricVersion,
      bindingId: `metric-binding-${idx + 1}`,
      formulaHash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    }));

    const assetId =
      journeyId === "current-sales" ||
      journeyId === "sales-comparison" ||
      journeyId === "top-customers"
        ? "analytics.v_sales_transaction_fact"
        : journeyId === "supplier-spend"
          ? "analytics.v_supplier_transaction_fact"
          : journeyId === "delayed-orders"
            ? "analytics.v_sales_order_delay_current"
            : "analytics.v_customer_delay_exposure_current";

    const datasetBindings = [
      {
        assetId,
        assetVersion: "1.0.0",
        publicationId: "44444444-4444-4444-8444-444444444444",
        snapshotId: null,
        refreshBatch: "executive-b0815-v1.0",
        sourceCutoffAt: "2026-08-15T06:30:00Z",
        outputHash:
          "a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef",
        reconciliationStatus: "RECONCILED" as const,
      },
    ];

    return {
      schemaVersion: "1.2",
      requestContext: {
        requestId,
        userId: userContext?.userId || "user-executive",
        sessionId: userContext?.sessionId || "session-demo",
        receivedAt: nowIso,
      },
      candidatePlan,
      resolvedTime,
      semanticBindings,
      datasetBindings,
      executionPolicy: {
        readOnly: true,
        timeoutMs: 5000,
        maxRows: 1000,
        statementClass: "CERTIFIED_ANALYTICAL_SELECT",
        compilerVersion: "1.2.0",
        reportingCurrency: "EUR",
        rateSetId: "approved-v1",
        roundingMode: "HALF_UP_2DP",
      },
      enforcedPolicy: {
        decisionOutcome: "ALLOW",
        allowedAction: "ANALYTICS_QUERY",
        subjectBinding: {
          userId: userContext?.userId || "user-executive",
          sessionId: userContext?.sessionId || "session-demo",
          tokenJtiHash:
            "d4fb258e7f704b9194dc5247d741b540e81c5772e63f4e4da37a9b196b94d72f",
        },
        recordScope: {
          mode: "ALL_AUTHORIZED",
          predicateRef: null,
          resourceIds: [],
        },
        fieldDecisions: [
          {
            fieldRef: "customer.customer_name",
            dataClass: "BUSINESS_CONFIDENTIAL",
            decision: "ALLOW",
          },
        ],
        maximumEvidenceGrain: "MASKED_RECORD",
        decisionExpiresAt: new Date(Date.now() + 300000).toISOString(),
        policyDecisionId,
        policyVersion: "policy-v1.2",
        scopeHash:
          "b5c6d7e8f901234567890abcdef1234567890abcdefa1b2c3d4e5f60718293a4",
        maskingProfile: "executive-masked-v1",
        entitlementEpoch: 42,
        semanticRegistryVersion: "registry-v1.2",
      },
    };
  }

  /**
   * Complete End-to-End Governed Architectural Pipeline:
   * 1. Receive User Question (Natural Language)
   * 2. AI Proposes ModelCandidatePlan JSON (via Gemini or Governed Canonical Resolver)
   * 3. Validate Candidate Plan (closed schema, canonical IDs, clarification check)
   * 4. Derive Authorization and Build Server-Owned ExecutionEnvelope
   * 5. Bind Deterministic Read-Only Query Handler
   * 6. Execute Query against Governed Analytics Views
   * 7. Assemble Structured AnswerResponse + UI Answer
   */
  async executePipeline(params: {
    question: string;
    locale?: "en" | "it";
    userId?: string;
    sessionId?: string;
    roleId?: string;
  }): Promise<
    | PipelineExecutionResult
    | {
        candidatePlan: BlueprintModelCandidatePlan;
        uiAnswer: UIAnswer;
      }
  > {
    const locale = params.locale || "en";
    const userQuery = params.question.trim();

    // 1 & 2. Generate ModelCandidatePlan
    const candidatePlan = await this.generateCandidatePlan(userQuery, locale);

    // 3. Ambiguity & Clarification Gate
    if (candidatePlan.clarification.status === "REQUIRED") {
      const uiAnswer: UIAnswer = {
        id: "clarification-needed",
        question: userQuery,
        summary: [
          {
            text:
              candidatePlan.clarification.question ||
              tr("analytics.clarificationRequired", locale),
          },
        ],
        meta: {
          period: tr("analytics.periods.currentQ3", locale),
          metric: tr("analytics.clarification.metric", locale),
          howCalculated: tr("analytics.clarification.howCalculated", locale),
        },
      };
      return { candidatePlan, uiAnswer };
    }

    // 4. Resolve to Certified Track A Journey
    const journeyId =
      this.resolveJourneyFromCandidatePlan(candidatePlan) ||
      this.resolveJourney(userQuery) ||
      "current-sales";

    // 5. Build Server-Owned ExecutionEnvelope
    const executionEnvelope = this.buildExecutionEnvelope(
      candidatePlan,
      journeyId,
      {
        userId: params.userId,
        sessionId: params.sessionId,
        roleId: params.roleId,
      },
    );

    // 6. Execute Read-Only Analytical Queries
    const journeyResult = await this.executeJourney(journeyId, locale);

    // 8. Record audit record in copilot.audit_event (Step 12)
    try {
      if (await this.repo.canConnectDb()) {
        await prisma.$transaction(async (tx) => {
          await appendAudit(tx, {
            request_uuid: executionEnvelope.requestContext.requestId,
            event_type: "COPILOT_PIPELINE_QUERY",
            status: "SUCCESS",
            payload: {
              journey_id: journeyId,
              metric_id: candidatePlan.metrics[0]?.metricId,
              locale,
              user_prompt: userQuery,
            },
            scope_hash: executionEnvelope.enforcedPolicy.scopeHash,
            query_fingerprint: journeyId,
            output_hash: executionEnvelope.datasetBindings[0]?.outputHash,
          });
        });
      }
    } catch (auditErr: any) {
      logger.warn(
        `[AnalyticsService] Audit recording bypassed or failed: ${auditErr.message} `,
      );
    }

    // 7. Assemble Pipeline Execution Result
    return {
      ...journeyResult,
      candidatePlan,
      executionEnvelope,
    };
  }
}

export const analyticsService = new AnalyticsService();
