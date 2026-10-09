import {
  defaultResilienceMetrics,
  AIResilienceMetrics,
} from "./resilience-metrics.js";
import { logger } from "@/shared/utils/logger.js";

export interface DegradedNarrativeResult {
  narrative: string;
  isDegraded: boolean;
  status: "COPILOT_MODEL_DEGRADED" | "COPILOT_NARRATIVE_VALIDATION_FAILED";
  httpStatusCode: 200;
  warningCode: string;
}

/**
 * NarrativeFallbackHandler
 *
 * Implements immediate degraded mode for narrative generation failures:
 * - Guarantees 0 structured results are lost.
 * - Decouples narrative generation from authoritative deterministic calculations.
 * - Emits COPILOT_MODEL_DEGRADED (HTTP 200) when narrative provider is unavailable or trips circuit.
 * - Emits COPILOT_NARRATIVE_VALIDATION_FAILED (HTTP 200) when AI narrative fails semantic checks.
 */
export class NarrativeFallbackHandler {
  constructor(
    private readonly metrics: AIResilienceMetrics = defaultResilienceMetrics,
  ) {}

  /**
   * Returns a deterministic degraded narrative when the AI narrative provider is unavailable.
   */
  public handleProviderDegraded(
    reason: string = "AI narrative generation unavailable",
  ): DegradedNarrativeResult {
    logger.warn(
      `[NarrativeFallback] Immediate degraded mode activated: ${reason}. Authoritative analytics preserved.`,
    );
    this.metrics.recordDegraded();

    return {
      narrative:
        "Deterministic analytical calculations generated successfully. Executive narrative interpretation is currently degraded.",
      isDegraded: true,
      status: "COPILOT_MODEL_DEGRADED",
      httpStatusCode: 200,
      warningCode: "COPILOT_MODEL_DEGRADED",
    };
  }

  /**
   * Returns a deterministic server narrative when an AI narrative fails verification.
   */
  public handleValidationFailure(
    discrepancyDetails?: string,
  ): DegradedNarrativeResult {
    logger.warn(
      `[NarrativeFallback] Narrative validation failure: ${discrepancyDetails || "Unverified claims detected"}. Reverting to certified server narrative.`,
    );
    this.metrics.recordDegraded();

    return {
      narrative:
        "Standard certified analytical calculation results generated. AI interpretation did not meet fidelity verification standards.",
      isDegraded: true,
      status: "COPILOT_NARRATIVE_VALIDATION_FAILED",
      httpStatusCode: 200,
      warningCode: "COPILOT_NARRATIVE_VALIDATION_FAILED",
    };
  }
}

export const defaultNarrativeFallbackHandler = new NarrativeFallbackHandler();
