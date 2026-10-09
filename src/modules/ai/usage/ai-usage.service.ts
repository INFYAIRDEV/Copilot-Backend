import {
  AIUsageRecord,
  AIUsageAuditMetadata,
  AIUsageSummary,
  AIUsageStatus,
  AIUsageQueryFilters,
} from "./ai-usage.types.js";
import {
  AIUsageCalculator,
  defaultUsageCalculator,
} from "./ai-usage.calculator.js";
import {
  IAIUsageRepository,
  defaultUsageRepository,
} from "./ai-usage.repository.js";
import { AIUsageTelemetry } from "../types/ai-provider.types.js";
import { logger } from "@/shared/utils/logger.js";

export interface TrackUsageInput {
  requestUuid: string;
  answerId?: number | null;
  provider: string;
  model: string;
  promptVersion?: string | null;
  purpose?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retryCount?: number;
  status?: AIUsageStatus;
}

export interface IAIUsageService {
  trackUsage(input: TrackUsageInput): Promise<AIUsageRecord>;
  trackFromTelemetry(
    telemetry: Partial<AIUsageTelemetry>,
    context: {
      requestUuid: string;
      answerId?: number | null;
      promptVersion?: string | null;
      purpose?: string;
      status?: AIUsageStatus;
    },
  ): Promise<AIUsageRecord>;
  getAuditMetadata(input: TrackUsageInput): AIUsageAuditMetadata;
  getUsageSummary(filters?: AIUsageQueryFilters): Promise<AIUsageSummary>;
  getUsageByRequestUuid(requestUuid: string): Promise<AIUsageRecord[]>;
}

/**
 * AIUsageService
 *
 * Centralized service managing AI model usage tracking, cost calculations,
 * and operational telemetry persistence in the copilot.model_usage table.
 *
 * Strict Privacy Guarantees:
 * - NEVER persists raw prompts, user question texts, or system instructions.
 * - NEVER persists raw AI response payloads or unmasked business datasets.
 * - Tracks only normalized tokens, latency, cost, provider, and operational status.
 */
export class AIUsageService implements IAIUsageService {
  constructor(
    private readonly repository: IAIUsageRepository = defaultUsageRepository,
    private readonly calculator: AIUsageCalculator = defaultUsageCalculator,
    private readonly failOpenOnPersistenceError: boolean = true,
  ) {}

  /**
   * Records AI token usage and operational telemetry.
   */
  public async trackUsage(input: TrackUsageInput): Promise<AIUsageRecord> {
    const inputTokens = Math.max(0, input.inputTokens || 0);
    const outputTokens = Math.max(0, input.outputTokens || 0);
    const totalTokens = inputTokens + outputTokens;
    const retryCount = Math.max(0, input.retryCount || 0);
    const status = input.status || "SUCCESS";
    const purpose = input.purpose || "CANDIDATE_PLAN";

    // Authoritative token-based cost calculation
    const estimatedCostUsd = this.calculator.calculateCost(
      input.provider,
      input.model,
      inputTokens,
      outputTokens,
    );

    const record: AIUsageRecord = {
      requestUuid: input.requestUuid,
      answerId: input.answerId ?? null,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion ?? null,
      purpose,
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs: Math.max(0, input.latencyMs || 0),
      estimatedCostUsd,
      retryCount,
      status,
    };

    logger.info(
      `[AIUsageService] Tracking usage [requestUuid: ${record.requestUuid}, provider: ${record.provider}, model: ${record.model}, tokens: ${record.totalTokens} (in: ${record.inputTokens}, out: ${record.outputTokens}), cost: $${record.estimatedCostUsd}, retries: ${record.retryCount}, status: ${record.status}]`,
    );

    try {
      return await this.repository.create(record);
    } catch (err: any) {
      logger.error(
        `[AIUsageService] Telemetry persistence failed [requestUuid: ${record.requestUuid}]: ${err.message}`,
      );

      if (this.failOpenOnPersistenceError) {
        // Return calculated record without blocking primary response
        return record;
      }
      throw err;
    }
  }

  /**
   * Tracks usage directly from normalized provider usage telemetry.
   */
  public async trackFromTelemetry(
    telemetry: Partial<AIUsageTelemetry>,
    context: {
      requestUuid: string;
      answerId?: number | null;
      promptVersion?: string | null;
      purpose?: string;
      status?: AIUsageStatus;
    },
  ): Promise<AIUsageRecord> {
    return this.trackUsage({
      requestUuid: context.requestUuid,
      answerId: context.answerId,
      provider: telemetry.providerName || "UNKNOWN_PROVIDER",
      model: telemetry.modelName || "UNKNOWN_MODEL",
      promptVersion: context.promptVersion,
      purpose: context.purpose,
      inputTokens: telemetry.inputTokens ?? 0,
      outputTokens: telemetry.outputTokens ?? 0,
      latencyMs: telemetry.latencyMs ?? 0,
      retryCount: telemetry.retryCount ?? 0,
      status: context.status,
    });
  }

  /**
   * Prepares normalized model metadata for inclusion in the audit_event decision path.
   */
  public getAuditMetadata(input: TrackUsageInput): AIUsageAuditMetadata {
    const inputTokens = Math.max(0, input.inputTokens || 0);
    const outputTokens = Math.max(0, input.outputTokens || 0);
    const totalTokens = inputTokens + outputTokens;
    const retryCount = Math.max(0, input.retryCount || 0);

    const estimatedCostUsd = this.calculator.calculateCost(
      input.provider,
      input.model,
      inputTokens,
      outputTokens,
    );

    return {
      requestUuid: input.requestUuid,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion || undefined,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      retryCount,
      status: input.status || "SUCCESS",
    };
  }

  /**
   * Computes an operational usage and cost summary across filtered usage records.
   */
  public async getUsageSummary(
    filters: AIUsageQueryFilters = {},
  ): Promise<AIUsageSummary> {
    const records = await this.repository.findMany(filters);
    return this.calculator.calculateSummary(records);
  }

  /**
   * Retrieves all usage records for a specific request UUID.
   */
  public async getUsageByRequestUuid(
    requestUuid: string,
  ): Promise<AIUsageRecord[]> {
    return this.repository.findByRequestUuid(requestUuid);
  }
}

export const defaultUsageService = new AIUsageService();
