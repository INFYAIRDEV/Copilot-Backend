import { IAIProvider, AIProviderMetadata } from "../interfaces/ai-provider.interface.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  ModelCandidatePlan,
} from "../types/ai-provider.types.js";
import { logger } from "@/shared/utils/logger.js";

export class StructuredFallbackProvider implements IAIProvider {
  private readonly metadata: AIProviderMetadata = {
    providerName: "STRUCTURED_FALLBACK",
    defaultModel: "deterministic-template-engine-v1",
    isAvailable: true,
  };

  public getProviderMetadata(): AIProviderMetadata {
    return this.metadata;
  }

  public async generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    const startTime = Date.now();
    logger.info(
      `[StructuredFallbackProvider] Executing deterministic fallback template for prompt: "${request.prompt.substring(0, 50)}..."`,
    );

    // AI-015 & AI-018: Construct deterministic candidate plan representation
    const fallbackPlan: ModelCandidatePlan = {
      planId: `fallback-plan-${Date.now()}`,
      candidateIntents: [
        {
          intentType: "AGGREGATION",
          primaryEntity: "analytics_summary",
          dimensions: ["category"],
          metrics: ["count"],
          limit: 50,
        },
      ],
      confidenceScore: 1.0,
      reasoningSummary:
        "Generated standard certified report template via structured fallback system during AI provider outage.",
      suggestedVisualization: "TABLE",
      isFallback: true,
    };

    const latencyMs = Date.now() - startTime;

    return {
      candidatePlan: fallbackPlan,
      narrative:
        "AI narrative generation is currently degraded. Certified structured reports remain fully available.",
      fromFallback: true,
      fallbackReason: "Primary AI provider is unavailable or circuit breaker triggered.",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs,
        providerName: this.metadata.providerName,
        modelName: this.metadata.defaultModel,
        retryCount: 0,
      },
    };
  }
}

export const structuredFallbackProvider = new StructuredFallbackProvider();
