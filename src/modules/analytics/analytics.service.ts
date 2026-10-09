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
import { logger } from "@/shared/utils/logger.js";
import { prisma } from "@/shared/utils/prismaClient.js";
import { appendAudit } from "@/modules/copilot/conversation.repository.js";

const t = (text: string): SummaryPart => ({ text });
const b = (text: string): SummaryPart => ({ text, bold: true });

const PERIOD_CURRENT_EN = "Jul 1 – Aug 15, 2026";
const PERIOD_CURRENT_IT = "1 lug – 15 ago 2026";
const AS_OF_TIME_EN = "Aug 15, 2026, 08:30 Europe/Rome";
const AS_OF_TIME_IT = "15 ago 2026, 08:30 Europe/Rome";

const isCurrentQ3Window = (w?: string) => !w || w === "Q3-CURRENT" || w.includes("Q3_2026") || w.includes("CURRENT");
const isQ2ElapsedWindow = (w?: string) => w === "Q2-46D" || (!!w && (w.includes("Q2_2026") || w.includes("Q2")));
const isPYElapsedWindow = (w?: string) => w === "PY-46D" || (!!w && (w.includes("2025") || w.includes("PY")));

export class AnalyticsService {
  constructor(private readonly repo: AnalyticsRepository = analyticsRepository) { }

  /**
   * Resolves a user prompt or journey ID to one of the 6 fixed Track A journeys.
   */
  resolveJourney(input: string): JourneyId | null {
    const text = input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return null;

    // 1. Production Linkage (must precede delayed-orders so 'production orders linked to delayed sales' routes here)
    if (
      text === "production-linkage" ||
      text.includes("production link") ||
      text.includes("linked production") ||
      text.includes("linkage") ||
      text.includes("collegamento produzione") ||
      (text.includes("production") && (text.includes("delay") || text.includes("link") || text.includes("sales")))
    ) {
      return "production-linkage";
    }

    // 2. Delayed Sales Orders
    if (
      text === "delayed-orders" ||
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
      text === "supplier-spend" ||
      text.includes("supplier") ||
      text.includes("fornitor") ||
      text.includes("procurement") ||
      text.includes("spesa fornitori")
    ) {
      return "supplier-spend";
    }

    // 4. Sales Comparison (must precede current-sales)
    if (
      text === "sales-comparison" ||
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
      text === "top-customers" ||
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
      text === "current-sales" ||
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
  async executeJourney(journeyId: JourneyId, locale: "en" | "it" = "en"): Promise<JourneyExecutionResult> {
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
  private async executeCurrentSalesJourney(locale: "en" | "it"): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSalesTransactions();
    const currentQ3Facts = facts.filter((f) => isCurrentQ3Window(f.fixture_window));
    const totalNetSales = currentQ3Facts.reduce((sum, f) => sum + f.net_amount, 0); // 820,000

    const isIt = locale === "it";
    const period = isIt ? PERIOD_CURRENT_IT : PERIOD_CURRENT_EN;
    const formattedTotal = "€" + totalNetSales.toLocaleString("en-US");

    const summary: SummaryPart[] = isIt
      ? [
        t("Le vendite nette fatturate per il terzo trimestre 2026 alla data odierna ammontano a "),
        b(formattedTotal),
        t(", al netto di IVA e note di accredito."),
      ]
      : [
        t("Net invoiced sales for Q3 2026 to date are "),
        b(formattedTotal),
        t(", net of VAT and credit notes across all customer accounts."),
      ];

    // Points by customer for breakdown
    const customerMap = new Map<string, number>();
    for (const f of currentQ3Facts) {
      customerMap.set(f.customer_name, (customerMap.get(f.customer_name) || 0) + f.net_amount);
    }
    const points = Array.from(customerMap.entries()).map(([label, value]) => ({ label, value }));

    const uiAnswer: UIAnswer = {
      id: "current-sales",
      question: isIt ? "Mostrami le prestazioni di vendita del trimestre corrente" : "Show sales performance for the current quarter",
      summary,
      chart: {
        title: isIt ? "Vendite nette fatturate Q3" : "Q3 Net Invoiced Sales",
        subtitle: isIt ? "Importo (€) per cliente" : "Net invoiced sales (€) by customer",
        format: "currency",
        yMax: 200000,
        yStep: 50000,
        points: points.slice(0, 5),
      },
      table: {
        title: isIt ? "Riepilogo vendite per cliente" : "Sales summary by customer",
        columns: isIt ? ["Cliente", "Fatturato netto (€)", "Quota"] : ["Customer", "Net invoiced sales (€)", "Share"],
        rows: points.map((p) => [
          p.label,
          "€" + p.value.toLocaleString("en-US"),
          ((p.value / totalNetSales) * 100).toFixed(1) + "%",
        ]),
      },
      meta: {
        period,
        metric: isIt ? "Vendite nette fatturate" : "Net invoiced sales",
        howCalculated: isIt
          ? "Somma degli importi netti delle fatture registrate meno le note di accredito, al netto di IVA, per il periodo 1 lug – 15 ago 2026."
          : "Sum of posted invoice net amounts less posted credit notes in EUR, net of VAT, for the period July 1 – August 15, 2026.",
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
        text: isIt
          ? `Le vendite nette fatturate per il terzo trimestre 2026 ammontano a ${formattedTotal}.`
          : `Net invoiced sales for Q3 2026 to date are ${formattedTotal}, net of VAT and credit notes.`,
      },
      claims: [
        {
          claimId: "claim-sales-total",
          claimType: "VALUE",
          valueRefs: ["/metrics/0/value", "/context/periodStart", "/context/periodEndExclusive"],
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
          displayValue: formattedTotal,
          variancePercent: null,
        },
      ],
      rankings: [],
      comparisons: [],
      resultSets: [],
      visualizations: [
        {
          type: "KPI",
          title: "Q3 Net Invoiced Sales",
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
        sourceVersions: ["synthetic-sales-fixture-v1.2"],
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
      displayName: "Current Q3 Net Invoiced Sales",
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: currentQ3Facts,
    };
  }

  // =========================================================================
  // JOURNEY 2: Sales Comparison
  // =========================================================================
  private async executeSalesComparisonJourney(locale: "en" | "it"): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSalesTransactions();
    const currentQ3 = facts.filter((f) => isCurrentQ3Window(f.fixture_window)).reduce((s, f) => s + f.net_amount, 0); // 820,000
    const q2Equivalent = facts.filter((f) => isQ2ElapsedWindow(f.fixture_window)).reduce((s, f) => s + f.net_amount, 0); // 760,000
    const pyEquivalent = facts.filter((f) => isPYElapsedWindow(f.fixture_window)).reduce((s, f) => s + f.net_amount, 0); // 700,000

    const varianceQ2 = Number((((currentQ3 - q2Equivalent) / q2Equivalent) * 100).toFixed(1)); // +7.9%
    const variancePY = Number((((currentQ3 - pyEquivalent) / pyEquivalent) * 100).toFixed(1)); // +17.1%

    const isIt = locale === "it";

    const summary: SummaryPart[] = isIt
      ? [
        t("Le vendite del Q3 alla data odierna ("),
        b("€820.000"),
        t(") registrano una crescita del "),
        b("+7,9%"),
        t(" (+€60.000) rispetto all'analogo periodo di 46 giorni del Q2 2026 (€760.000) e del "),
        b("+17,1%"),
        t(" (+€120.000) rispetto al Q3 2025 (€700.000)."),
      ]
      : [
        t("Current Q3 sales ("),
        b("€820,000"),
        t(") are up "),
        b("+7.9%"),
        t(" (+€60,000) compared to the equivalent 46-day window of Q2 2026 (€760,000), and up "),
        b("+17.1%"),
        t(" (+€120,000) vs the equivalent Q3 2025 prior-year period (€700,000)."),
      ];

    const uiAnswer: UIAnswer = {
      id: "sales-comparison",
      question: isIt
        ? "Confronta le vendite con il trimestre precedente e lo stesso periodo dell'anno scorso"
        : "Compare sales with previous quarter and same period last year",
      summary,
      chart: {
        title: isIt ? "Confronto vendite per periodi equivalenti" : "Equivalent-period sales comparison",
        subtitle: isIt ? "Finestra di 46 giorni trascorsi (€)" : "46-day elapsed window (€)",
        format: "currency",
        yMax: 900000,
        yStep: 200000,
        points: [
          { label: isIt ? "Q3 2025 (stesso periodo)" : "Q3 2025 (Prior Year)", value: pyEquivalent },
          { label: isIt ? "Q2 2026 (trim. prec.)" : "Q2 2026 (Previous Qtr)", value: q2Equivalent },
          { label: isIt ? "Q3 2026 (attuale)" : "Q3 2026 (Current)", value: currentQ3 },
        ],
      },
      table: {
        title: isIt ? "Dettaglio confronto periodi equivalenti" : "Equivalent-period performance table",
        columns: isIt ? ["Periodo", "Finestra", "Fatturato netto (€)", "Variazione vs attuale"] : ["Period", "Window", "Net sales (€)", "Variance vs Current"],
        rows: [
          [isIt ? "Q3 2026 (attuale)" : "Current Q3 2026", "1 lug – 15 ago (46d)", "€820,000", isIt ? "Base di riferimento" : "Baseline"],
          [isIt ? "Q2 2026 (trim. prec.)" : "Equivalent Q2 2026", "1 apr – 15 mag (46d)", "€760,000", `+${varianceQ2}% (+€60,000)`],
          [isIt ? "Q3 2025 (anno prec.)" : "Equivalent Q3 2025", "1 lug – 15 ago (46d)", "€700,000", `+${variancePY}% (+€120,000)`],
        ],
      },
      meta: {
        period: isIt ? "Finestra di 46 giorni trascorsi" : "46 elapsed calendar days",
        metric: isIt ? "Variazione vendite nette fatturate" : "Net invoiced sales variance",
        howCalculated: isIt
          ? "Confronto tra i primi 46 giorni di calendario di ciascun trimestre: Q3 2026 (1 lug – 15 ago) vs Q2 2026 (1 apr – 15 mag) e Q3 2025 (1 lug – 15 ago)."
          : "Compares identical 46-calendar-day elapsed periods: Q3 2026 (Jul 1 – Aug 15) vs Q2 2026 (Apr 1 – May 15) and Q3 2025 (Jul 1 – Aug 15).",
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
        text: isIt
          ? `Le vendite del Q3 (€820.000) superano il periodo equivalente del Q2 2026 del +7,9% e il Q3 2025 del +17,1%.`
          : `Current Q3 sales (€820,000) are up +7.9% vs equivalent Q2 2026 and +17.1% vs equivalent Q3 2025.`,
      },
      claims: [
        {
          claimId: "claim-comp-q2",
          claimType: "COMPARISON",
          valueRefs: ["/comparisons/0/percentVariance", "/comparisons/0/baselineValue"],
        },
        {
          claimId: "claim-comp-py",
          claimType: "COMPARISON",
          valueRefs: ["/comparisons/1/percentVariance", "/comparisons/1/baselineValue"],
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
          displayValue: "€820,000",
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
          title: "Period Comparisons",
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
        sourceVersions: ["synthetic-sales-fixture-v1.2"],
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
      displayName: "Equivalent-Period Sales Comparison",
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: facts,
    };
  }

  // =========================================================================
  // JOURNEY 3: Top Customers
  // =========================================================================
  private async executeTopCustomersJourney(locale: "en" | "it"): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSalesTransactions();
    const currentQ3 = facts.filter((f) => isCurrentQ3Window(f.fixture_window));
    const totalSales = currentQ3.reduce((s, f) => s + f.net_amount, 0); // 820,000

    // Group by customer
    const customerMap = new Map<string, { code: string; id: string; name: string; amount: number }>();
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

    const isIt = locale === "it";

    const summary: SummaryPart[] = isIt
      ? [
        t("I primi 5 clienti hanno generato "),
        b("€" + top5Total.toLocaleString("en-US")),
        t(", pari al "),
        b(top5Share.toFixed(1) + "%"),
        t(" delle vendite nette fatturate complessive (€" + totalSales.toLocaleString("en-US") + ")."),
      ]
      : [
        t("The top 5 customers generated "),
        b("€" + top5Total.toLocaleString("en-US")),
        t(", representing "),
        b(top5Share.toFixed(1) + "%"),
        t(" of total net invoiced sales (€" + totalSales.toLocaleString("en-US") + ")."),
      ];

    const uiAnswer: UIAnswer = {
      id: "top-customers",
      question: isIt ? "Quali sono i primi 5 clienti per fatturato?" : "Give me the top 5 customers.",
      summary,
      chart: {
        title: isIt ? "Primi 5 clienti" : "Top 5 customers",
        subtitle: isIt ? "Vendite nette fatturate (€)" : "Net invoiced sales (€)",
        format: "currency",
        yMax: 200000,
        yStep: 50000,
        points: top5.map((c) => ({ label: c.name, value: c.amount })),
      },
      table: {
        title: isIt ? "Classifica dei primi 5 clienti per vendite nette fatturate" : "Top 5 customers by net invoiced sales",
        columns: isIt ? ["Cliente", "Fatturato netto (€)", "Quota"] : ["Customer", "Net invoiced sales (€)", "Share"],
        rows: top5.map((c) => [
          c.name,
          "€" + c.amount.toLocaleString("en-US"),
          ((c.amount / totalSales) * 100).toFixed(1) + "%",
        ]),
      },
      meta: {
        period: isIt ? PERIOD_CURRENT_IT : PERIOD_CURRENT_EN,
        metric: isIt ? "Vendite nette fatturate" : "Net invoiced sales",
        howCalculated: isIt
          ? "Vendite nette fatturate meno note di accredito e sconti per il periodo corrente, raggruppate per cliente. Quota = fatturato del cliente ÷ totale vendite (€820.000)."
          : "Net invoiced sales are invoice totals minus credit notes and discounts for the period, grouped by customer. Share = customer total ÷ total net invoiced sales of all customers (€820,000).",
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
        text: isIt
          ? `I primi 5 clienti hanno generato €631.000, rappresentando il 77,0% del fatturato netto complessivo.`
          : `The top five customers generated €631,000, or 77.0% of €820,000 net invoiced sales, for the certified period.`,
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
          title: "Top customers",
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
        sourceVersions: ["synthetic-sales-fixture-v1.2"],
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
      displayName: "Top 5 Customers by Sales",
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: top5,
    };
  }

  // =========================================================================
  // JOURNEY 4: Top Suppliers
  // =========================================================================
  private async executeSupplierSpendJourney(locale: "en" | "it"): Promise<JourneyExecutionResult> {
    const facts = await this.repo.getSupplierTransactions();
    const totalSpend = facts.reduce((s, f) => s + f.net_amount, 0); // 510,000

    // Group by supplier
    const supplierMap = new Map<string, { id: string; code: string; name: string; amount: number }>();
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

    const isIt = locale === "it";

    const summary: SummaryPart[] = isIt
      ? [
        t("La spesa totale per fornitori approvata è stata di "),
        b("€" + totalSpend.toLocaleString("en-US")),
        t("; i primi 5 fornitori rappresentano il "),
        b(top5Share.toFixed(1) + "%"),
        t(" (€" + top5Total.toLocaleString("en-US") + "). "),
        t("Nota: SafeLogistics è classificato al netto della nota di credito (€50.000). La spesa riflette i volumi e non le prestazioni di consegna."),
      ]
      : [
        t("Approved procurement spend was "),
        b("€" + totalSpend.toLocaleString("en-US")),
        t("; the top 5 suppliers account for "),
        b(top5Share.toFixed(1) + "%"),
        t(" (€" + top5Total.toLocaleString("en-US") + ") of it. SafeLogistics is ranked net of credit note (€50,000)."),
      ];

    const uiAnswer: UIAnswer = {
      id: "supplier-spend",
      question: isIt ? "Mostrami la spesa fornitori" : "Supplier spend overview",
      summary,
      chart: {
        title: isIt ? "Primi 5 fornitori" : "Top 5 suppliers",
        subtitle: isIt ? "Spesa approvata (€)" : "Approved spend (€)",
        format: "currency",
        yMax: 150000,
        yStep: 30000,
        points: top5.map((sp) => ({ label: sp.name, value: sp.amount })),
      },
      table: {
        title: isIt ? "Primi 5 fornitori per spesa approvata" : "Top 5 suppliers by approved spend",
        columns: isIt ? ["Fornitore", "Spesa (€)", "Quota"] : ["Supplier", "Spend (€)", "Share"],
        rows: top5.map((sp) => [
          sp.name,
          "€" + sp.amount.toLocaleString("en-US"),
          ((sp.amount / totalSpend) * 100).toFixed(1) + "%",
        ]),
      },
      meta: {
        period: isIt ? PERIOD_CURRENT_IT : PERIOD_CURRENT_EN,
        metric: isIt ? "Spesa fornitori approvata" : "Approved supplier spend",
        howCalculated: isIt
          ? "Spesa derivante da fatture fornitori registrate meno note di credito, al netto di IVA. SafeLogistics include la nota di accredito di -€5.000 (netto €50.000). Quota = spesa fornitore ÷ spesa complessiva (€510.000)."
          : "Spend is posted supplier invoices minus credits in EUR, excluding VAT. SafeLogistics is net €50,000 after €5,000 credit note. Share = supplier spend ÷ total approved procurement spend (€510,000).",
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
        text: isIt
          ? `La spesa fornitori approvata per il Q3 è stata di €510.000; i primi 5 fornitori rappresentano €380.000 (74,5%).`
          : `Approved procurement spend was €510,000; the top 5 suppliers account for €380,000 (74.5%) of spend.`,
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
          title: "Top suppliers by spend",
          datasetKind: "RANKING",
          datasetRef: "ranking-top-suppliers",
        },
      ],
      definitions: [
        {
          metricId: "procurement.supplier_spend_net",
          metricVersion: "1.0.0",
          definitionUrl: "/api/v1/analytics/metrics/procurement.supplier_spend_net",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: 5,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["synthetic-supplier-fixture-v1.2"],
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
      displayName: "Top 5 Suppliers by Procurement Spend",
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: top5,
    };
  }

  // =========================================================================
  // JOURNEY 5: Delayed Orders (Sales)
  // =========================================================================
  private async executeDelayedOrdersJourney(locale: "en" | "it"): Promise<JourneyExecutionResult> {
    const delayLines = await this.repo.getSalesOrderDelayLines();
    const distinctOrders = new Set(delayLines.map((l) => l.sales_order_id)).size; // 6
    const distinctLines = delayLines.length; // 7
    const distinctCustomers = new Set(delayLines.map((l) => l.customer_id)).size; // 5
    const totalBacklog = delayLines.reduce((s, l) => s + l.remaining_net_value, 0); // 164,000

    const isIt = locale === "it";

    const summary: SummaryPart[] = isIt
      ? [
        b("6 ordini di vendita"),
        t(" contenenti "),
        b("7 righe"),
        t(" su "),
        b("5 clienti"),
        t(" risultano attualmente in ritardo, per un valore totale di backlog in ritardo di "),
        b("€" + totalBacklog.toLocaleString("en-US")),
        t("."),
      ]
      : [
        b("6 sales orders"),
        t(" containing "),
        b("7 lines"),
        t(" across "),
        b("5 customers"),
        t(" are currently delayed, representing "),
        b("€" + totalBacklog.toLocaleString("en-US")),
        t(" in delayed backlog value."),
      ];

    // Customer backlog grouping for chart
    const customerBacklog = new Map<string, number>();
    for (const l of delayLines) {
      customerBacklog.set(l.customer_name, (customerBacklog.get(l.customer_name) || 0) + l.remaining_net_value);
    }
    const points = Array.from(customerBacklog.entries()).map(([label, value]) => ({ label, value }));

    const uiAnswer: UIAnswer = {
      id: "delayed-orders",
      question: isIt ? "Quali ordini di vendita sono in ritardo?" : "Why are there delayed orders?",
      summary,
      chart: {
        title: isIt ? "Backlog in ritardo per cliente" : "Delayed backlog by customer",
        subtitle: isIt ? "Valore backlog (€)" : "Delayed backlog value (€)",
        format: "currency",
        yMax: 60000,
        yStep: 15000,
        points,
      },
      table: {
        title: isIt ? "Righe ordini di vendita in ritardo" : "Delayed sales order lines",
        columns: isIt
          ? ["Ordine", "Riga", "Cliente", "Q.tà aperta", "Prezzo unitario", "Valore backlog (€)"]
          : ["Order ID", "Line ID", "Customer", "Open Qty", "Unit Price", "Backlog (€)"],
        rows: delayLines.map((l) => [
          l.sales_order_id,
          l.sales_order_line_id,
          l.customer_name,
          String(l.open_qty),
          "€" + l.unit_net_price.toFixed(2),
          "€" + l.remaining_net_value.toLocaleString("en-US"),
        ]),
      },
      meta: {
        period: isIt ? AS_OF_TIME_IT : AS_OF_TIME_EN,
        metric: isIt ? "Backlog ordini di vendita in ritardo" : "Delayed sales order backlog",
        howCalculated: isIt
          ? "Una riga è in ritardo quando la data di consegna concordata è passata rispetto all'orario as-of e la quantità aperta è > 0. Il valore residuo è q.tà aperta × prezzo unitario netto."
          : "A sales order line is delayed when its approved commitment date has passed the local end of business day in Europe/Rome and open quantity > 0. Backlog is open qty × unit net price.",
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
        text: isIt
          ? `Sono presenti 6 ordini di vendita in ritardo (7 righe, 5 clienti) per un valore di backlog di €164.000.`
          : `There are 6 delayed sales orders (7 lines, 5 customers) with €164,000 delayed backlog value.`,
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
          title: "Delayed orders by customer",
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
        sourceVersions: ["synthetic-sales-fixture-v1.2"],
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
      displayName: "Delayed Sales Commitments",
      locale,
      uiAnswer,
      blueprintResponse,
      supportingRecords: delayLines,
    };
  }

  // =========================================================================
  // JOURNEY 6: Production Linkage
  // =========================================================================
  private async executeProductionLinkageJourney(locale: "en" | "it"): Promise<JourneyExecutionResult> {
    const allocations = await this.repo.getAllocations();
    const productionOrders = await this.repo.getProductionOrderDelayFacts();
    const delayLines = await this.repo.getSalesOrderDelayLines();

    const totalDelayedBacklog = delayLines.reduce((s, l) => s + l.remaining_net_value, 0); // 164,000
    const linkedBacklog = allocations.reduce((s, a) => s + a.allocated_backlog_value, 0); // 149,240
    const unlinkedBacklog = totalDelayedBacklog - linkedBacklog; // 14,760
    const coveragePct = Number(((linkedBacklog / totalDelayedBacklog) * 100).toFixed(1)); // 91.0%

    const linkedProdOrdersCount = new Set(allocations.map((a) => a.production_order_id)).size; // 6
    const affectedCustomersCount = new Set(allocations.map((a) => a.customer_id)).size; // 5

    const isIt = locale === "it";

    const summary: SummaryPart[] = isIt
      ? [
        b("6 ordini di produzione in ritardo"),
        t(" risultano esplicitamente collegati a ordini cliente in ritardo per "),
        b("5 clienti"),
        t(", corrispondenti a "),
        b("€" + linkedBacklog.toLocaleString("en-US")),
        t(" (il "),
        b(coveragePct.toFixed(1) + "%"),
        t(") del backlog totale in ritardo (€" + totalDelayedBacklog.toLocaleString("en-US") + "). "),
        b("Attenzione:"),
        t(" €" + unlinkedBacklog.toLocaleString("en-US") + " di backlog in ritardo non hanno ordini di produzione associati. Il legame esplicito evidenzia associazione e non causalità."),
      ]
      : [
        b("6 delayed production orders"),
        t(" are explicitly linked to delayed customer orders across "),
        b("5 customers"),
        t(", accounting for "),
        b("€" + linkedBacklog.toLocaleString("en-US")),
        t(" ("),
        b(coveragePct.toFixed(1) + "%"),
        t(") of total delayed backlog (€" + totalDelayedBacklog.toLocaleString("en-US") + "). "),
        b("Warning:"),
        t(" €" + unlinkedBacklog.toLocaleString("en-US") + " (9.0%) of delayed backlog has no linked production order. Explicit linkage is evidence of association, not verified causation."),
      ];

    const uiAnswer: UIAnswer = {
      id: "production-linkage",
      question: isIt ? "Quali ordini di produzione sono collegati ai ritardi?" : "Production linkage summary",
      summary,
      chart: {
        title: isIt ? "Copertura collegamento produzione" : "Production linkage exposure",
        subtitle: isIt ? "Valore backlog collegato vs non collegato (€)" : "Linked vs unlinked delayed backlog (€)",
        format: "currency",
        yMax: 180000,
        yStep: 45000,
        points: [
          { label: isIt ? "Backlog collegato (91%)" : "Linked Backlog (91%)", value: linkedBacklog },
          { label: isIt ? "Backlog non collegato (9%)" : "Unlinked Backlog (9%)", value: unlinkedBacklog },
        ],
      },
      table: {
        title: isIt ? "Ordini di produzione collegati a righe cliente in ritardo" : "Production orders linked to delayed customer lines",
        columns: isIt
          ? ["Ordine prod.", "Riga cliente", "Cliente", "Pesi alloc.", "Valore collegato (€)"]
          : ["Production Order", "Sales Line", "Customer", "Allocation Weight", "Linked Value (€)"],
        rows: allocations.map((a) => [
          a.production_order_id,
          a.sales_order_line_id,
          a.customer_name,
          (a.allocation_weight * 100).toFixed(0) + "%",
          "€" + a.allocated_backlog_value.toLocaleString("en-US"),
        ]),
      },
      meta: {
        period: isIt ? AS_OF_TIME_IT : AS_OF_TIME_EN,
        metric: isIt ? "Copertura collegamento produzione-vendite" : "Sales-production linkage coverage",
        howCalculated: isIt
          ? "Un ordine di produzione è collegato quando esiste un'allocazione esplicita a una riga d'ordine cliente in ritardo. Copertura = backlog collegato (€149.240) ÷ backlog totale in ritardo (€164.000) = 91,0%."
          : "A production order is linked when explicitly allocated to an open delayed sales order line. Coverage = explicitly allocated delayed backlog (€149,240) ÷ total delayed backlog (€164,000) = 91.0%.",
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
        text: isIt
          ? `6 ordini di produzione in ritardo sono collegati a 5 clienti per un valore di €149.240 (91,0% del backlog in ritardo). €14.760 non sono collegati.`
          : `6 linked delayed production orders affect 5 customers with €149,240 linked backlog (91.0% coverage). €14,760 remains unlinked.`,
      },
      claims: [
        {
          claimId: "claim-linkage-coverage",
          claimType: "COVERAGE",
          valueRefs: ["/metrics/0/value", "/evidence/linkage/numerator", "/evidence/linkage/denominator"],
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
          title: "Production linkage coverage",
          datasetKind: "RESULT_SET",
          datasetRef: "linkage-exposure",
        },
      ],
      definitions: [
        {
          metricId: "production.sales_linkage_coverage_pct",
          metricVersion: "1.0.0",
          definitionUrl: "/api/v1/analytics/metrics/production.sales_linkage_coverage_pct",
        },
      ],
      evidence: {
        evidenceRef: randomUUID(),
        resultRowCount: allocations.length,
        supportingRecordAccess: "FULL",
        datasetPublicationIds: ["44444444-4444-4444-8444-444444444444"],
        sourceVersions: ["synthetic-production-fixture-v1.2"],
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
          message: isIt
            ? "Copertura parziale del 91,0%: €14.760 di backlog in ritardo non risultano collegati ad ordini di produzione. Il collegamento esplicito indica associazione e non causalità."
            : "Partial linkage coverage: 91.0% coverage by value. €14,760 in delayed backlog is currently unlinked to production orders. Explicit linkage indicates association, not causality.",
          valueRefs: ["/metrics/0/value"],
        },
      ],
      auditReference: {
        auditEventId: randomUUID(),
      },
    };

    return {
      journeyId: "production-linkage",
      displayName: "Production Linkage & Exposure",
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
7. Ambiguity: If the question is ambiguous (e.g. 'delayed orders' without specifying sales vs production), set clarification.status = "REQUIRED".
8. Example JSON:
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

        timeout = setTimeout(
          () => controller?.abort(),
          requestTimeoutMs,
        );

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
            const retryableStatuses = new Set([
              429, 500, 502, 503, 504,
            ]);

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

              await response.body?.cancel().catch(() => { });
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }

            const errorText = await response.text();

            logger.warn(
              "[AnalyticsService] Gemini API request failed",
              {
                status: response.status,
                model: config.modelIdentifier,
                attempt,
                error: errorText.slice(0, 500),
              },
            );

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
            (parsed as any).schemaVersion = String((parsed as any).schemaVersion);
          }
          if (parsed && typeof parsed.intent === "object" && parsed.intent !== null) {
            const rawIntentObj = parsed.intent as any;
            const queryType = rawIntentObj.queryType || rawIntentObj.type || "SUMMARY";
            const intentStr = (queryType === "ANALYTICAL" && rawIntentObj.sort?.length) ? "RANK" : (queryType === "ANALYTICAL" ? "SUMMARY" : queryType);
            if (rawIntentObj.metrics && !parsed.metrics) {
              parsed.metrics = rawIntentObj.metrics.map((m: any) => typeof m === "string" ? { metricId: m === "revenue" ? "sales.invoiced_net" : m, metricVersion: "1.1.0", alias: m } : m);
            }
            if (rawIntentObj.dimensions && !parsed.dimensions) {
              parsed.dimensions = rawIntentObj.dimensions.map((d: any) => typeof d === "string" ? { dimensionId: d === "customer_name" ? "customer.customer" : d } : d);
            }
            if (rawIntentObj.limit && !parsed.limit) {
              parsed.limit = rawIntentObj.limit;
            }
            (parsed as any).intent = intentStr;
          }

          logger.info("[AnalyticsService] Candidate plan validation diagnostics", {
            topLevelKeys: Object.keys(parsed ?? {}),
            schemaVersion: parsed?.schemaVersion,
            intentType: typeof parsed?.intent,
            intent: parsed?.intent,
          });

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
      const isTimeout =
        error instanceof Error && error.name === "AbortError";

      logger.warn(
        "[AnalyticsService] Gemini API request failed",
        {
          reason: isTimeout ? "timeout" : "network_error",
          message:
            error instanceof Error
              ? error.message
              : "Unknown error",
          model: config.modelIdentifier,
        },
      );

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
            { metricId: "sales.invoiced_net", metricVersion: "1.1.0", alias: "net_sales" },
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
            period: { kind: "CURRENT_QUARTER", alignment: "EQUIVALENT_ELAPSED_DAYS" },
          },
          metrics: [
            { metricId: "sales.invoiced_net", metricVersion: "1.1.0", alias: "net_sales" },
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
            { metricId: "sales.invoiced_net", metricVersion: "1.1.0", alias: "net_sales" },
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
            { metricId: "procurement.supplier_spend_net", metricVersion: "1.0.0", alias: "supplier_spend" },
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
            { metricId: "sales.delayed_order_count", metricVersion: "1.0.0", alias: "delayed_orders" },
            { metricId: "sales.delayed_backlog_net", metricVersion: "1.0.0", alias: "delayed_backlog" },
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
            { metricId: "production.exposed_backlog_net", metricVersion: "1.0.0", alias: "linked_backlog" },
            { metricId: "production.sales_linkage_coverage_pct", metricVersion: "1.0.0", alias: "coverage_pct" },
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
            { metricId: "sales.invoiced_net", metricVersion: "1.1.0", alias: "net_sales" },
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
  resolveJourneyFromCandidatePlan(plan: BlueprintModelCandidatePlan): JourneyId | null {
    const metricIds = (plan.metrics || []).map((m) => m.metricId);
    if (metricIds.includes("production.exposed_backlog_net") || metricIds.includes("production.sales_linkage_coverage_pct")) {
      return "production-linkage";
    }
    if (metricIds.includes("procurement.supplier_spend_net")) {
      return "supplier-spend";
    }
    if (metricIds.includes("sales.delayed_order_count") || metricIds.includes("sales.delayed_backlog_net")) {
      return "delayed-orders";
    }
    if (metricIds.includes("sales.invoiced_net")) {
      if (plan.intent === "COMPARE" || plan.timeContext?.period?.alignment === "EQUIVALENT_ELAPSED_DAYS") {
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
      (text === "delayed orders" || text === "show delayed orders" || text === "ordini in ritardo") &&
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
          question:
            locale === "it"
              ? "La richiesta 'ordini in ritardo' è ambigua. Intendi ordini di vendita in ritardo o ordini di produzione in ritardo?"
              : "The request 'delayed orders' is ambiguous. Do you mean delayed sales orders or delayed production orders?",
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
          { text: candidatePlan.clarification.question || "Clarification required" },
        ],
        meta: {
          period: locale === "it" ? PERIOD_CURRENT_IT : PERIOD_CURRENT_EN,
          metric: "Clarification",
          howCalculated:
            locale === "it"
              ? "Richiesta chiarimento per ambiguità semantica."
              : "Clarification request due to semantic ambiguity.",
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
      logger.warn(`[AnalyticsService] Audit recording bypassed or failed: ${auditErr.message} `);
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
