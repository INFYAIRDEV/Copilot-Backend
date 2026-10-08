import { Prisma } from "@prisma/client";
import { prisma as defaultPrismaClient } from "@/shared/utils/prismaClient.js";
import { AIUsageRecord, AIUsageQueryFilters } from "./ai-usage.types.js";
import { logger } from "@/shared/utils/logger.js";

export interface IAIUsageRepository {
  create(record: AIUsageRecord): Promise<AIUsageRecord>;
  findByRequestUuid(requestUuid: string): Promise<AIUsageRecord[]>;
  findMany(filters?: AIUsageQueryFilters): Promise<AIUsageRecord[]>;
}

/**
 * AIUsageRepository
 *
 * Manages database persistence of AI model usage records in the copilot.model_usage table.
 * Strips all internal raw prompts and provider credentials before persistence.
 */
export class AIUsageRepository implements IAIUsageRepository {
  constructor(private readonly prisma: any = defaultPrismaClient) {}

  /**
   * Persists an AI model usage record to the copilot.model_usage table.
   */
  public async create(record: AIUsageRecord): Promise<AIUsageRecord> {
    try {
      const data: any = {
        request_uuid: record.requestUuid,
        answer_id: record.answerId ?? null,
        provider: record.provider,
        model: record.model,
        prompt_version: record.promptVersion ?? null,
        purpose: record.purpose,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        latency_ms: record.latencyMs,
        estimated_cost:
          record.estimatedCostUsd !== undefined && record.estimatedCostUsd !== null
            ? new Prisma.Decimal(record.estimatedCostUsd)
            : null,
        retry_count: record.retryCount,
        status: record.status,
      };

      const created = await this.prisma.model_usage.create({
        data,
      });

      return {
        id: created.id,
        requestUuid: created.request_uuid,
        answerId: created.answer_id,
        provider: created.provider,
        model: created.model,
        promptVersion: created.prompt_version,
        purpose: created.purpose,
        inputTokens: created.input_tokens ?? 0,
        outputTokens: created.output_tokens ?? 0,
        totalTokens: (created.input_tokens ?? 0) + (created.output_tokens ?? 0),
        latencyMs: created.latency_ms ?? 0,
        estimatedCostUsd: created.estimated_cost ? Number(created.estimated_cost) : null,
        retryCount: created.retry_count,
        status: created.status as any,
        createdAt: created.created_at,
      };
    } catch (err: any) {
      logger.error(
        `[AIUsageRepository] Failed to persist model usage record [requestUuid: ${record.requestUuid}]: ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * Retrieves usage records associated with a specific request UUID.
   */
  public async findByRequestUuid(requestUuid: string): Promise<AIUsageRecord[]> {
    try {
      const records = await this.prisma.model_usage.findMany({
        where: { request_uuid: requestUuid },
        orderBy: { created_at: "asc" },
      });

      return records.map((r: any) => this.mapRecord(r));
    } catch (err: any) {
      logger.error(
        `[AIUsageRepository] Failed to query model usage by request_uuid [${requestUuid}]: ${err.message}`,
      );
      return [];
    }
  }

  /**
   * Queries usage records based on filtering parameters.
   */
  public async findMany(filters: AIUsageQueryFilters = {}): Promise<AIUsageRecord[]> {
    try {
      const where: any = {};
      if (filters.requestUuid) where.request_uuid = filters.requestUuid;
      if (filters.provider) where.provider = filters.provider;
      if (filters.model) where.model = filters.model;
      if (filters.purpose) where.purpose = filters.purpose;
      if (filters.status) where.status = filters.status;
      if (filters.startDate || filters.endDate) {
        where.created_at = {};
        if (filters.startDate) where.created_at.gte = filters.startDate;
        if (filters.endDate) where.created_at.lte = filters.endDate;
      }

      const records = await this.prisma.model_usage.findMany({
        where,
        take: filters.limit ?? 100,
        orderBy: { created_at: "desc" },
      });

      return records.map((r: any) => this.mapRecord(r));
    } catch (err: any) {
      logger.error(`[AIUsageRepository] Failed to query model usage records: ${err.message}`);
      return [];
    }
  }

  private mapRecord(r: any): AIUsageRecord {
    return {
      id: r.id,
      requestUuid: r.request_uuid,
      answerId: r.answer_id,
      provider: r.provider,
      model: r.model,
      promptVersion: r.prompt_version,
      purpose: r.purpose,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      totalTokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
      latencyMs: r.latency_ms ?? 0,
      estimatedCostUsd: r.estimated_cost ? Number(r.estimated_cost) : null,
      retryCount: r.retry_count,
      status: r.status as any,
      createdAt: r.created_at,
    };
  }
}

export const defaultUsageRepository = new AIUsageRepository();
