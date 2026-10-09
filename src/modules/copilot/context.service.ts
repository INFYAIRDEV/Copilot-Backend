import { message_kind, conversation_state } from "@prisma/client";
import { conversationRepository } from "./conversation.repository.js";
import { CopilotError } from "./copilot.error.js";
import {
  NormalizedAnalyticalContext,
  CandidateContextUpdate,
  normalizedAnalyticalContextSchema,
  createDefaultAnalyticalContext,
  FORBIDDEN_CONTEXT_KEYS,
} from "./context.types.js";
import { createHash, randomUUID } from "node:crypto";

const CANONICAL_TERM_MAP: Record<string, string> = {
  // Metrics
  sales: "sales_total",
  sales_total: "sales_total",
  vendite: "sales_total",
  fatturato: "sales_total",
  revenue: "sales_total",
  orders: "orders_count",
  orders_count: "orders_count",
  ordini: "orders_count",
  delayed_orders: "delayed_orders",
  ordini_in_ritardo: "delayed_orders",
  executive_cost_margin: "executive_cost_margin",
  cost_margin: "executive_cost_margin",

  // Dimensions
  customer: "customer",
  cliente: "customer",
  clienti: "customer",
  country: "country",
  paese: "country",
  product: "product",
  prodotto: "product",
  prodotti: "product",
  category: "category",
  categoria: "category",
  region: "region",
  regione: "region",
  date: "date",
  data: "date",
  period: "period",
  periodo: "period",

  // Country values
  italy: "IT",
  italia: "IT",
  it: "IT",
  germany: "DE",
  germania: "DE",
  de: "DE",
  france: "FR",
  francia: "FR",
  fr: "FR",

  // Time granularities & periods
  quarter: "QUARTER",
  trimestre: "QUARTER",
  month: "MONTH",
  mese: "MONTH",
  year: "YEAR",
  anno: "YEAR",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
};

export const CERTIFIED_METRICS = new Set([
  "sales_total",
  "orders_count",
  "delayed_orders",
  "executive_cost_margin",
]);

export const CERTIFIED_DIMENSIONS = new Set([
  "customer",
  "country",
  "product",
  "category",
  "region",
  "date",
  "period",
]);

export function resolveCanonicalTerm(rawTerm: string): string {
  if (!rawTerm || typeof rawTerm !== "string") return rawTerm;
  const normalized = rawTerm
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return CANONICAL_TERM_MAP[normalized] || normalized;
}

export class ContextService {
  constructor(private readonly repo = conversationRepository) {}

  /**
   * Retrieves the current normalized analytical context for a conversation.
   * Enforces authentication, conversation ownership, and lifecycle status.
   */
  async retrieveContext(
    conversationUuidOrId: string | number,
    userId: number,
  ): Promise<{
    conversationId: number;
    conversationUuid: string;
    version: number;
    context: NormalizedAnalyticalContext;
  }> {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new CopilotError(401, "UNAUTHENTICATED", "Authentication required");
    }

    const conversation =
      typeof conversationUuidOrId === "number"
        ? await this.repo.findOwnedById(conversationUuidOrId, userId)
        : await this.repo.findOwned(conversationUuidOrId, userId);

    if (!conversation) {
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "Conversation access denied",
      );
    }

    if (
      conversation.state === conversation_state.DELETED ||
      conversation.deleted_at !== null
    ) {
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "Conversation access denied",
      );
    }

    const convVersion = conversation.version ?? 1;
    let parsedContext: NormalizedAnalyticalContext;
    if (conversation.analytical_context) {
      const parsed = normalizedAnalyticalContextSchema.safeParse(
        conversation.analytical_context,
      );
      parsedContext = parsed.success
        ? { ...parsed.data, version: convVersion }
        : { ...createDefaultAnalyticalContext(), version: convVersion };
    } else {
      parsedContext = {
        ...createDefaultAnalyticalContext(),
        version: convVersion,
      };
    }

    return {
      conversationId: conversation.id,
      conversationUuid: conversation.conversation_uuid,
      version: convVersion,
      context: parsedContext,
    };
  }

  /**
   * Merges an existing normalized analytical context with a candidate turn update.
   * Supports:
   * - Full context reset when update.isReset is true.
   * - Context inheritance for unaffected metrics, dimensions, filters, periods, etc.
   * - Precise context overrides for modified properties.
   */
  mergeContext(
    existing: NormalizedAnalyticalContext,
    update: CandidateContextUpdate,
  ): NormalizedAnalyticalContext {
    if (update.isReset) {
      const fresh = createDefaultAnalyticalContext();
      if (update.metrics && update.metrics.length > 0) {
        fresh.metricRefs = update.metrics.map(resolveCanonicalTerm);
      }
      if (update.dimensions && update.dimensions.length > 0) {
        fresh.dimensionRefs = update.dimensions.map(resolveCanonicalTerm);
      }
      if (update.filters && update.filters.length > 0) {
        fresh.filters = update.filters.map((f) => ({
          ...f,
          field: resolveCanonicalTerm(f.field),
          value:
            typeof f.value === "string"
              ? resolveCanonicalTerm(f.value)
              : f.value,
        }));
      }
      if (update.groupBy) {
        fresh.groupBy = update.groupBy.map(resolveCanonicalTerm);
      }
      if (update.sort) fresh.sort = update.sort;
      if (update.period) fresh.period = update.period;
      if (update.comparison) fresh.comparison = update.comparison;
      if (update.currency) fresh.currency = update.currency;
      if (update.timezone) fresh.timezone = update.timezone;
      if (update.mode) fresh.mode = update.mode;
      if (update.drillDown) fresh.drillDown = update.drillDown;
      return fresh;
    }

    // 1. Metrics: inherit unless explicitly overridden
    const newMetrics =
      update.metrics !== undefined && update.metrics.length > 0
        ? update.metrics.map(resolveCanonicalTerm)
        : [...existing.metricRefs];

    // 2. Dimensions: inherit unless explicitly overridden
    const newDimensions =
      update.dimensions !== undefined
        ? update.dimensions.map(resolveCanonicalTerm)
        : [...existing.dimensionRefs];

    // 3. Filters: field-level override, inherit other fields
    let newFilters = [...existing.filters];
    if (update.filters && update.filters.length > 0) {
      for (const filter of update.filters) {
        const canonicalField = resolveCanonicalTerm(filter.field);
        const canonicalValue =
          typeof filter.value === "string"
            ? resolveCanonicalTerm(filter.value)
            : filter.value;
        const normalizedFilter = {
          ...filter,
          field: canonicalField,
          value: canonicalValue,
        };
        // Replace existing filter on same field, or append
        const existingIdx = newFilters.findIndex(
          (f) => f.field === canonicalField,
        );
        if (existingIdx >= 0) {
          newFilters[existingIdx] = normalizedFilter;
        } else {
          newFilters.push(normalizedFilter);
        }
      }
    }

    // 4. GroupBy: override if specified, else inherit
    const newGroupBy =
      update.groupBy !== undefined
        ? update.groupBy.map(resolveCanonicalTerm)
        : [...existing.groupBy];

    // 5. Sort: override if specified, else inherit
    const newSort =
      update.sort !== undefined ? [...update.sort] : [...existing.sort];

    // 6. Period: override if specified, else inherit
    const newPeriod =
      update.period !== undefined
        ? update.period
          ? {
              ...update.period,
              value: update.period.value
                ? resolveCanonicalTerm(update.period.value)
                : update.period.value,
            }
          : null
        : existing.period;

    // 7. Comparison: override if specified, else inherit
    const newComparison =
      update.comparison !== undefined
        ? update.comparison
          ? {
              ...update.comparison,
              value: update.comparison.value
                ? resolveCanonicalTerm(update.comparison.value)
                : update.comparison.value,
            }
          : null
        : existing.comparison;

    // 8. Other analytical settings
    const newCurrency =
      update.currency !== undefined ? update.currency : existing.currency;
    const newTimezone =
      update.timezone !== undefined ? update.timezone : existing.timezone;
    const newMode = update.mode !== undefined ? update.mode : existing.mode;
    const newDrillDown =
      update.drillDown !== undefined ? update.drillDown : existing.drillDown;

    return {
      metricRefs: newMetrics,
      dimensionRefs: newDimensions,
      filters: newFilters,
      groupBy: newGroupBy,
      sort: newSort,
      period: newPeriod,
      comparison: newComparison,
      currency: newCurrency,
      timezone: newTimezone,
      mode: newMode,
      drillDown: newDrillDown,
      datasetId: existing.datasetId,
      datasetVersion: existing.datasetVersion,
      semanticVersion: existing.semanticVersion,
      version: existing.version,
    };
  }

  /**
   * Validates structural integrity, ensures absence of forbidden SQL / credentials,
   * certifies metrics/dimensions/filters, and enforces RBAC/policy constraints on metrics.
   */
  validateContext(
    context: NormalizedAnalyticalContext,
    userContext: { userId: number; roleId: string },
  ): { isValid: boolean; errors?: string[] } {
    const errors: string[] = [];

    // Structural validation
    const parsed = normalizedAnalyticalContextSchema.safeParse(context);
    if (!parsed.success) {
      return {
        isValid: false,
        errors: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      };
    }

    // Security check: inspect JSON string for forbidden patterns / SQL injection
    const jsonStr = JSON.stringify(context);
    for (const forbidden of FORBIDDEN_CONTEXT_KEYS) {
      if (jsonStr.toLowerCase().includes(`"${forbidden}"`)) {
        errors.push(
          `Forbidden security field in analytical context: ${forbidden}`,
        );
      }
    }

    if (/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(jsonStr)) {
      errors.push(
        "Raw SQL statements are strictly forbidden in analytical context",
      );
    }

    // Metric existence/certification
    for (const m of context.metricRefs) {
      if (!CERTIFIED_METRICS.has(m)) {
        errors.push(`Invalid metric reference: '${m}' is not certified`);
      }
    }

    // Dimension existence/certification
    for (const d of context.dimensionRefs) {
      if (!CERTIFIED_DIMENSIONS.has(d)) {
        errors.push(`Invalid dimension reference: '${d}' is not certified`);
      }
    }

    // GroupBy existence/certification
    for (const g of context.groupBy) {
      if (!CERTIFIED_DIMENSIONS.has(g)) {
        errors.push(
          `Invalid groupBy dimension reference: '${g}' is not certified`,
        );
      }
    }

    // Filter validity and combination checks
    for (const f of context.filters) {
      if (
        !CERTIFIED_DIMENSIONS.has(f.field) &&
        !CERTIFIED_METRICS.has(f.field)
      ) {
        errors.push(`Invalid filter dimension: '${f.field}' is not certified`);
      }

      if (f.operator === "BETWEEN") {
        if (!Array.isArray(f.value) || f.value.length !== 2) {
          errors.push(
            `Invalid filter combination: operator 'BETWEEN' on '${f.field}' requires an array of 2 values`,
          );
        }
      }

      if (f.operator === "IN") {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          errors.push(
            `Invalid filter combination: operator 'IN' on '${f.field}' requires a non-empty array`,
          );
        }
      }

      if (["=", "!=", ">", "<", ">=", "<="].includes(f.operator)) {
        if (Array.isArray(f.value)) {
          errors.push(
            `Invalid filter combination: scalar operator '${f.operator}' on '${f.field}' cannot have an array value`,
          );
        }
      }
    }

    // Policy & RBAC checks: role 'operator' cannot access executive metrics
    if (userContext.roleId === "operator") {
      if (context.metricRefs.includes("executive_cost_margin")) {
        errors.push(
          `Unauthorized metric access: role '${userContext.roleId}' cannot access 'executive_cost_margin'`,
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Persists the validated normalized analytical context into the database
   * using optimistic concurrency version checking.
   */
  async persistContext(
    conversationId: number,
    expectedVersion: number,
    context: NormalizedAnalyticalContext,
    auditMeta?: {
      request_uuid?: string;
      scope_hash?: string;
      requestUuid?: string;
      scopeHash?: string;
    },
  ): Promise<NormalizedAnalyticalContext> {
    const nextVersion = expectedVersion + 1;
    const contextToStore: NormalizedAnalyticalContext = {
      ...context,
      version: nextVersion,
    };

    const success = await this.repo.updateAnalyticalContext(
      conversationId,
      expectedVersion,
      contextToStore,
      auditMeta
        ? {
            request_uuid: auditMeta.request_uuid || auditMeta.requestUuid,
            scope_hash: auditMeta.scope_hash || auditMeta.scopeHash,
          }
        : undefined,
    );

    if (!success) {
      throw new CopilotError(
        409,
        "CONVERSATION_VERSION_CONFLICT",
        "Optimistic concurrency conflict: conversation version has changed",
      );
    }

    return contextToStore;
  }

  /**
   * Preserves existing context untouched when clarification is needed
   * or when a turn is ambiguous.
   */
  handleClarification(
    existingContext: NormalizedAnalyticalContext,
    _kind: message_kind | string,
  ): NormalizedAnalyticalContext {
    // Returns existing context without any modification
    return existingContext;
  }
}

export const contextService = new ContextService(conversationRepository);
