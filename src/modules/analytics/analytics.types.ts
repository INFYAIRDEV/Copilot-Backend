export type JourneyId =
  | "current-sales"
  | "sales-comparison"
  | "top-customers"
  | "supplier-spend"
  | "delayed-orders"
  | "production-linkage";

export type ValueFormat = "currency" | "count" | "percent";

export interface SummaryPart {
  text: string;
  bold?: boolean;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartData {
  title: string;
  subtitle: string;
  format: ValueFormat;
  yMax: number;
  yStep: number;
  points: ChartPoint[];
}

export interface TableData {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface AnswerMeta {
  period: string;
  metric: string;
  howCalculated: string;
}

export interface UIAnswer {
  id: JourneyId | string;
  question: string;
  summary: SummaryPart[];
  chart?: ChartData;
  table?: TableData;
  meta?: AnswerMeta;
}

export interface BlueprintAnswerResponse {
  schemaVersion: "1.2";
  requestId: string;
  answerId: string;
  status: "SUCCESS" | "PARTIAL" | "EMPTY" | "REFUSED" | "FAILED";
  summary: {
    locale: "en" | "it";
    statementType:
      "FACTUAL_SUMMARY" | "CLARIFICATION" | "UNAVAILABLE" | "ERROR";
    generationMode: "SERVER_TEMPLATE" | "MODEL_VALIDATED";
    claimRefs: string[];
    text: string;
  };
  claims: Array<{
    claimId: string;
    claimType: "VALUE" | "COMPARISON" | "RANKING" | "COVERAGE" | "WARNING";
    valueRefs: string[];
  }>;
  context: {
    mode:
      | "CURRENT_STATE"
      | "TRANSACTION_PERIOD"
      | "AS_WAS_OPERATIONAL"
      | "AS_KNOWN_THEN"
      | "CORRECTED_HISTORY"
      | "FORECAST";
    timezone: "Europe/Rome";
    calendarId: string;
    asOf: string;
    periodStart?: string | null;
    periodEndExclusive?: string | null;
    currency: string;
    rateSet?: string | null;
    rounding?: string;
  };
  metrics: Array<{
    metricId: string;
    metricVersion: string;
    value: number | null;
    unit: string;
    displayValue?: string | null;
    variancePercent?: number | null;
  }>;
  rankings: Array<{
    rankingId: string;
    entityDimensionId: string;
    measure: {
      metricId: string;
      metricVersion: string;
      unit: string;
    };
    direction: "ASC" | "DESC";
    tieBreaker: string;
    totalValue: number;
    topNValue: number;
    topNSharePercent: number;
    rows: Array<{
      rank: number;
      entityId: string;
      entityCode: string;
      displayName: string;
      value: number;
      displayValue: string;
      sharePercent: number;
    }>;
  }>;
  comparisons: Array<{
    comparisonId: string;
    currentMetricRef: string;
    baselinePeriodStart: string;
    baselinePeriodEndExclusive: string;
    baselineValue: number;
    absoluteVariance: number;
    percentVariance: number;
  }>;
  resultSets: any[];
  visualizations: Array<{
    type: "KPI" | "TABLE" | "LINE" | "BAR" | "DONUT";
    title: string;
    datasetKind: "METRIC" | "RANKING" | "COMPARISON" | "RESULT_SET";
    datasetRef: string;
  }>;
  definitions: Array<{
    metricId: string;
    metricVersion: string;
    definitionUrl: string;
  }>;
  evidence: {
    evidenceRef: string;
    resultRowCount: number;
    supportingRecordAccess: "NONE" | "MASKED" | "FULL";
    datasetPublicationIds: string[];
    snapshotId?: string | null;
    sourceVersions: string[];
    linkage?: {
      numerator: number;
      denominator: number;
      unit: string;
    } | null;
  };
  freshness: {
    sourceCutoffAt: string;
    status: "FRESH" | "STALE" | "UNKNOWN";
    reconciliationStatus: "RECONCILED" | "UNRECONCILED" | "PARTIAL";
    publicationId: string;
  };
  warnings: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    message: string;
    valueRefs: string[];
  }>;
  auditReference: {
    auditEventId: string;
  };
}

export interface JourneyExecutionResult {
  journeyId: JourneyId;
  displayName: string;
  locale: "en" | "it";
  uiAnswer: UIAnswer;
  blueprintResponse: BlueprintAnswerResponse;
  supportingRecords: any[];
}

export interface BlueprintModelCandidatePlan {
  schemaVersion: "1.2";
  intent:
    "SUMMARY" | "TREND" | "COMPARE" | "RANK" | "DETAIL" | "EXPLAIN_VARIANCE";
  timeContext: {
    mode:
      | "CURRENT_STATE"
      | "TRANSACTION_PERIOD"
      | "AS_WAS_OPERATIONAL"
      | "AS_KNOWN_THEN"
      | "CORRECTED_HISTORY"
      | "FORECAST";
    timezone: "Europe/Rome";
    calendarId: string;
    period?: {
      kind: string;
      startDate?: string;
      endDateExclusive?: string;
      alignment: "FULL_PERIOD" | "EQUIVALENT_ELAPSED_DAYS";
    };
    validAt?: string;
    recordedAt?: string;
    forecastAsOf?: string;
    baselineId?: string;
  };
  metrics: Array<{
    metricId: string;
    metricVersion: string;
    alias: string;
  }>;
  dimensions: Array<{
    dimensionId: string;
  }>;
  filters: Array<{
    dimensionId: string;
    operator:
      | "EQ"
      | "NEQ"
      | "IN"
      | "NOT_IN"
      | "GT"
      | "GTE"
      | "LT"
      | "LTE"
      | "BETWEEN"
      | "IS_NULL"
      | "IS_NOT_NULL";
    values: Array<string | number | boolean | null>;
  }>;
  sort: Array<{
    fieldRef: string;
    direction: "ASC" | "DESC";
  }>;
  limit: number;
  freshnessRequirement: {
    maximumAgeMinutes: number;
    onStale: "WARN" | "REFUSE";
  };
  clarification: {
    status: "RESOLVED" | "REQUIRED";
    question: string | null;
  };
}

export interface BlueprintExecutionEnvelope {
  schemaVersion: "1.2";
  requestContext: {
    requestId: string;
    userId: string;
    sessionId: string;
    receivedAt: string;
  };
  candidatePlan: BlueprintModelCandidatePlan;
  resolvedTime: {
    mode: string;
    timezone: "Europe/Rome";
    calendarId: string;
    periodStartUtc?: string;
    periodEndUtcExclusive?: string;
    validAtUtc?: string;
    recordedAtUtc?: string;
    forecastAsOfUtc?: string;
    baselineId?: string;
  };
  semanticBindings: Array<{
    bindingKind: "METRIC" | "DIMENSION" | "FILTER" | "SORT";
    candidateRef: string;
    registryId: string;
    version: string;
    bindingId: string;
    formulaHash: string;
  }>;
  datasetBindings: Array<{
    assetId: string;
    assetVersion: string;
    publicationId: string;
    snapshotId: string | null;
    refreshBatch: string;
    sourceCutoffAt: string;
    outputHash: string;
    reconciliationStatus: "RECONCILED";
  }>;
  executionPolicy: {
    readOnly: true;
    timeoutMs: number;
    maxRows: number;
    statementClass: "CERTIFIED_ANALYTICAL_SELECT";
    compilerVersion: string;
    reportingCurrency: string;
    rateSetId: string | null;
    roundingMode: string;
  };
  enforcedPolicy: {
    decisionOutcome: "ALLOW";
    allowedAction: "ANALYTICS_QUERY";
    subjectBinding: {
      userId: string;
      sessionId: string;
      tokenJtiHash: string;
    };
    recordScope: {
      mode: "ALL_AUTHORIZED" | "PREDICATE_REF" | "EXPLICIT_IDS";
      predicateRef: string | null;
      resourceIds: string[];
    };
    fieldDecisions: Array<{
      fieldRef: string;
      dataClass: string;
      decision: "ALLOW" | "MASK" | "DENY";
    }>;
    maximumEvidenceGrain: "AGGREGATE" | "MASKED_RECORD" | "FULL_RECORD";
    decisionExpiresAt: string;
    policyDecisionId: string;
    policyVersion: string;
    scopeHash: string;
    maskingProfile: string;
    entitlementEpoch: number;
    semanticRegistryVersion: string;
  };
}

export interface PipelineExecutionResult extends JourneyExecutionResult {
  candidatePlan: BlueprintModelCandidatePlan;
  executionEnvelope: BlueprintExecutionEnvelope;
}
