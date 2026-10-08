import crypto from "node:crypto";
import {
  AIProviderResponse,
  ModelCandidatePlan,
  AIUsageTelemetry,
} from "../types/ai-provider.types.js";
import { PromptMetadata } from "../prompts/prompt.types.js";
import {
  AIResponseStatus,
  AIResponseMetadata,
  AIResponseAuditMetadata,
  AIResponseTelemetryRecord,
  NormalizedUsageTelemetry,
} from "./ai-response.types.js";

/**
 * AIResponseNormalizer
 *
 * Normalizes provider outputs into application-owned data structures,
 * calculates cryptographic verification hashes, formats telemetry records
 * for the copilot.model_usage table, and formats audit metadata for copilot.audit_event.
 */
export class AIResponseNormalizer {
  /**
   * Generates a deterministic SHA-256 hash for any serializable object.
   */
  public static hashObject(obj: unknown): string {
    if (obj === undefined || obj === null) {
      return "";
    }
    const stableString = this.stableStringify(obj);
    return crypto.createHash("sha256").update(stableString).digest("hex");
  }

  /**
   * Generates a deterministic string representation with sorted keys.
   */
  public static stableStringify(obj: unknown): string {
    if (typeof obj !== "object" || obj === null) {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return "[" + obj.map((item) => this.stableStringify(item)).join(",") + "]";
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (key) =>
        `${JSON.stringify(key)}:${this.stableStringify((obj as Record<string, unknown>)[key])}`,
    );
    return "{" + pairs.join(",") + "}";
  }

  /**
   * Normalizes provider usage telemetry into application-owned NormalizedUsageTelemetry.
   */
  public static normalizeUsage(
    rawUsage?: Partial<AIUsageTelemetry>,
    status: AIResponseStatus = "SUCCESS",
    durationMs: number = 0,
  ): NormalizedUsageTelemetry {
    const provider = rawUsage?.providerName || "UNKNOWN_PROVIDER";
    const model = rawUsage?.modelName || "UNKNOWN_MODEL";
    const inputTokens = rawUsage?.inputTokens ?? 0;
    const outputTokens = rawUsage?.outputTokens ?? 0;
    const totalTokens = rawUsage?.totalTokens ?? inputTokens + outputTokens;
    const latencyMs = rawUsage?.latencyMs ?? durationMs;
    const retryCount = rawUsage?.retryCount ?? 0;
    const estimatedCostUsd = rawUsage?.estimatedCostUsd;

    let requestOutcome: "SUCCESS" | "FALLBACK" | "DEGRADED" | "FAILED" = "SUCCESS";
    if (status === "FALLBACK") {
      requestOutcome = "FALLBACK";
    } else if (status === "DEGRADED") {
      requestOutcome = "DEGRADED";
    } else if (status === "ERROR") {
      requestOutcome = "FAILED";
    }

    return {
      provider,
      providerName: provider,
      model,
      modelName: model,
      modelVersion: rawUsage?.modelVersion,
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs,
      retryCount,
      requestOutcome,
      estimatedCostUsd,
    };
  }

  /**
   * Creates an operational telemetry record matching the copilot.model_usage table schema.
   */
  public static createTelemetryRecord(
    usage: NormalizedUsageTelemetry,
    context: {
      correlationId: string;
      promptVersion?: string;
      purpose?: string;
      status: AIResponseStatus;
    },
  ): AIResponseTelemetryRecord {
    return {
      requestUuid: context.correlationId,
      provider: usage.provider,
      model: usage.model,
      promptVersion: context.promptVersion,
      purpose: context.purpose || "CANDIDATE_PLAN",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      latencyMs: usage.latencyMs,
      estimatedCostUsd: usage.estimatedCostUsd,
      retryCount: usage.retryCount,
      status: context.status,
    };
  }

  /**
   * Creates audit event metadata matching the copilot.audit_event contract.
   */
  public static createAuditMetadata(
    context: {
      correlationId: string;
      providerName: string;
      modelName: string;
      status: AIResponseStatus;
      planHash?: string;
      outputHash?: string;
      warningCodes?: string[];
    },
  ): AIResponseAuditMetadata {
    return {
      requestUuid: context.correlationId,
      planHash: context.planHash,
      outputHash: context.outputHash,
      providerName: context.providerName,
      modelName: context.modelName,
      status: context.status,
      warningCodes: context.warningCodes || [],
    };
  }

  /**
   * Normalizes response metadata.
   */
  public static createResponseMetadata(
    correlationId: string,
    options: {
      promptMetadata?: PromptMetadata;
      planHash?: string;
      outputHash?: string;
    } = {},
  ): AIResponseMetadata {
    return {
      correlationId,
      timestamp: new Date().toISOString(),
      promptKey: options.promptMetadata?.promptKey,
      promptVersion: options.promptMetadata?.version,
      planHash: options.planHash,
      outputHash: options.outputHash,
    };
  }
}
