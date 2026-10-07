import { BaseAIProviderAdapter } from "./base-ai-provider.adapter.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  ModelCandidatePlan,
  AIProviderException,
} from "../types/ai-provider.types.js";

export class MockAIProviderAdapter extends BaseAIProviderAdapter {
  private simulateTransientError: boolean = false;
  private simulateNonTransientError: boolean = false;

  constructor(providerName: string = "MOCK_AI_PROVIDER") {
    super({
      providerName,
      defaultModel: "mock-llm-v1",
      modelVersion: "1.0.0",
      region: "eu-west-1",
      isAvailable: true,
    });
  }

  public setSimulateTransientError(enable: boolean): void {
    this.simulateTransientError = enable;
  }

  public setSimulateNonTransientError(enable: boolean): void {
    this.simulateNonTransientError = enable;
  }

  public async generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    const startTime = Date.now();

    try {
      if (this.simulateTransientError) {
        throw new Error("Simulated transient connection timeout");
      }

      if (this.simulateNonTransientError) {
        throw new Error("400 Bad Request: Invalid prompt payload rejected by provider");
      }

      // Simulate model latency
      await new Promise((resolve) => setTimeout(resolve, 20));

      const candidatePlan: ModelCandidatePlan = {
        planId: `plan-${Date.now()}`,
        candidateIntents: [
          {
            intentType: "AGGREGATION",
            primaryEntity: "sales_transaction",
            dimensions: ["region", "product_category"],
            metrics: ["total_revenue", "order_count"],
            timeRange: {
              granularity: "MONTH",
            },
            limit: 100,
          },
        ],
        confidenceScore: 0.94,
        reasoningSummary: `Generated plan for query: "${request.prompt}"`,
        suggestedVisualization: "BAR_CHART",
        isFallback: false,
      };

      const latencyMs = Date.now() - startTime;
      const inputTokens = Math.max(10, Math.ceil(request.prompt.length / 4));
      const outputTokens = 150;

      return {
        candidatePlan,
        narrative: "Revenue increased across European regions in Q3.",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          latencyMs,
          providerName: this.metadata.providerName,
          modelName: this.metadata.defaultModel,
          modelVersion: this.metadata.modelVersion,
          region: this.metadata.region,
          estimatedCostUsd: 0.00045,
          retryCount: 0,
        },
        fromFallback: false,
      };
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }
}
