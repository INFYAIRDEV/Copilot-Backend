import {
  ModelCandidatePlan,
  CandidateQueryIntent,
} from "../types/ai-provider.types.js";

export interface CandidatePlanValidationResult {
  isValid: boolean;
  errors: string[];
}

const VALID_INTENT_TYPES = new Set([
  "AGGREGATION",
  "FILTER",
  "TREND",
  "COMPARISON",
  "UNKNOWN",
]);

const VALID_OPERATORS = new Set([
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "IN",
  "LIKE",
]);

const VALID_GRANULARITIES = new Set([
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
]);

const VALID_VISUALIZATIONS = new Set([
  "TABLE",
  "BAR_CHART",
  "LINE_CHART",
  "KPI_CARD",
  "PIE_CHART",
]);

/**
 * CandidatePlanValidator
 *
 * Performs strict structural integrity validation on candidate plans returned
 * from AI providers before they can proceed downstream to semantic and policy validation.
 *
 * Validates:
 * - Basic object structure
 * - Required candidate plan fields (planId, candidateIntents, confidenceScore)
 * - Candidate intents array non-empty and well-formed
 * - Supported intent types and operators
 * - Value types and bounds
 */
export class CandidatePlanValidator {
  public static validate(candidate: unknown): CandidatePlanValidationResult {
    const errors: string[] = [];

    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return {
        isValid: false,
        errors: ["Candidate plan must be a non-null object"],
      };
    }

    const plan = candidate as Partial<ModelCandidatePlan>;

    // 1. Validate planId
    if (typeof plan.planId !== "string" || plan.planId.trim().length === 0) {
      errors.push("Missing or invalid 'planId': must be a non-empty string");
    }

    // 2. Validate confidenceScore
    if (
      typeof plan.confidenceScore !== "number" ||
      isNaN(plan.confidenceScore) ||
      plan.confidenceScore < 0 ||
      plan.confidenceScore > 1
    ) {
      errors.push(
        "Invalid 'confidenceScore': must be a number between 0.0 and 1.0",
      );
    }

    // 3. Validate isFallback flag
    if (typeof plan.isFallback !== "boolean") {
      errors.push("Invalid 'isFallback': must be a boolean");
    }

    // 4. Validate suggestedVisualization (optional)
    if (
      plan.suggestedVisualization !== undefined &&
      !VALID_VISUALIZATIONS.has(plan.suggestedVisualization)
    ) {
      errors.push(
        `Invalid 'suggestedVisualization': got '${plan.suggestedVisualization}', supported values are ${Array.from(VALID_VISUALIZATIONS).join(", ")}`,
      );
    }

    // 5. Validate reasoningSummary (optional)
    if (
      plan.reasoningSummary !== undefined &&
      typeof plan.reasoningSummary !== "string"
    ) {
      errors.push("Invalid 'reasoningSummary': must be a string");
    }

    // 6. Validate candidateIntents
    if (
      !Array.isArray(plan.candidateIntents) ||
      plan.candidateIntents.length === 0
    ) {
      errors.push(
        "Missing or empty 'candidateIntents': must contain at least one intent",
      );
    } else {
      plan.candidateIntents.forEach((intent, index) => {
        const intentErrors = this.validateIntent(intent, index);
        errors.push(...intentErrors);
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private static validateIntent(intent: unknown, index: number): string[] {
    const errors: string[] = [];
    const prefix = `Intent[${index}]`;

    if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
      return [`${prefix}: must be a non-null object`];
    }

    const queryIntent = intent as Partial<CandidateQueryIntent>;

    // intentType
    if (
      typeof queryIntent.intentType !== "string" ||
      !VALID_INTENT_TYPES.has(queryIntent.intentType)
    ) {
      errors.push(
        `${prefix}: invalid 'intentType' ('${queryIntent.intentType}'). Supported: ${Array.from(VALID_INTENT_TYPES).join(", ")}`,
      );
    }

    // primaryEntity
    if (
      typeof queryIntent.primaryEntity !== "string" ||
      queryIntent.primaryEntity.trim().length === 0
    ) {
      errors.push(`${prefix}: missing or invalid 'primaryEntity'`);
    }

    // dimensions
    if (
      !Array.isArray(queryIntent.dimensions) ||
      !queryIntent.dimensions.every((d) => typeof d === "string")
    ) {
      errors.push(`${prefix}: 'dimensions' must be an array of strings`);
    }

    // metrics
    if (
      !Array.isArray(queryIntent.metrics) ||
      !queryIntent.metrics.every((m) => typeof m === "string")
    ) {
      errors.push(`${prefix}: 'metrics' must be an array of strings`);
    }

    // filters (optional)
    if (queryIntent.filters !== undefined) {
      if (!Array.isArray(queryIntent.filters)) {
        errors.push(`${prefix}: 'filters' must be an array`);
      } else {
        queryIntent.filters.forEach((filter, fIndex) => {
          if (!filter || typeof filter !== "object") {
            errors.push(`${prefix}.filters[${fIndex}]: must be an object`);
          } else {
            if (
              typeof filter.field !== "string" ||
              filter.field.trim().length === 0
            ) {
              errors.push(
                `${prefix}.filters[${fIndex}]: missing or invalid 'field'`,
              );
            }
            if (
              typeof filter.operator !== "string" ||
              !VALID_OPERATORS.has(filter.operator)
            ) {
              errors.push(
                `${prefix}.filters[${fIndex}]: invalid 'operator' ('${filter.operator}')`,
              );
            }
            if (filter.value === undefined) {
              errors.push(`${prefix}.filters[${fIndex}]: missing 'value'`);
            }
          }
        });
      }
    }

    // timeRange (optional)
    if (queryIntent.timeRange !== undefined) {
      if (
        typeof queryIntent.timeRange !== "object" ||
        queryIntent.timeRange === null
      ) {
        errors.push(`${prefix}: 'timeRange' must be an object`);
      } else {
        const tr = queryIntent.timeRange;
        if (
          tr.granularity !== undefined &&
          !VALID_GRANULARITIES.has(tr.granularity)
        ) {
          errors.push(
            `${prefix}.timeRange: invalid 'granularity' ('${tr.granularity}')`,
          );
        }
      }
    }

    // limit (optional)
    if (queryIntent.limit !== undefined) {
      if (
        typeof queryIntent.limit !== "number" ||
        isNaN(queryIntent.limit) ||
        queryIntent.limit <= 0 ||
        !Number.isInteger(queryIntent.limit)
      ) {
        errors.push(`${prefix}: 'limit' must be a positive integer`);
      }
    }

    return errors;
  }
}
