import {
  ModelPricingConfig,
  AIUsageRecord,
  AIUsageSummary,
} from "./ai-usage.types.js";

/**
 * Standard default model pricing configuration table (USD per 1,000,000 tokens).
 * Externalized and configurable to allow operational updates without changing business code.
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricingConfig> = {
  // Google Gemini models
  "gemini-1.5-flash": {
    provider: "google",
    model: "gemini-1.5-flash",
    inputCostPerMillion: 0.075, // $0.075 per 1M input tokens
    outputCostPerMillion: 0.3, // $0.30 per 1M output tokens
    currency: "USD",
  },
  "gemini-1.5-pro": {
    provider: "google",
    model: "gemini-1.5-pro",
    inputCostPerMillion: 3.5, // $3.50 per 1M input tokens
    outputCostPerMillion: 10.5, // $10.50 per 1M output tokens
    currency: "USD",
  },

  // OpenAI models
  "gpt-4o-mini": {
    provider: "openai",
    model: "gpt-4o-mini",
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    currency: "USD",
  },
  "gpt-4o": {
    provider: "openai",
    model: "gpt-4o",
    inputCostPerMillion: 5.0,
    outputCostPerMillion: 15.0,
    currency: "USD",
  },

  // Mock and Fallback (Zero cost)
  "mock-model-v1": {
    provider: "mock",
    model: "mock-model-v1",
    inputCostPerMillion: 0.0,
    outputCostPerMillion: 0.0,
    currency: "USD",
  },
  "deterministic-template-engine-v1": {
    provider: "STRUCTURED_FALLBACK",
    model: "deterministic-template-engine-v1",
    inputCostPerMillion: 0.0,
    outputCostPerMillion: 0.0,
    currency: "USD",
  },
};

/**
 * AIUsageCalculator
 *
 * Computes model inference costs based on authoritative token counts and
 * model pricing configurations. Computes operational cost-per-successful-answer metrics.
 */
export class AIUsageCalculator {
  private readonly pricingTable: Map<string, ModelPricingConfig>;

  constructor(customPricing?: Record<string, ModelPricingConfig>) {
    this.pricingTable = new Map();

    // Load defaults
    for (const [key, config] of Object.entries(DEFAULT_MODEL_PRICING)) {
      this.pricingTable.set(
        this.normalizeKey(config.provider, config.model),
        config,
      );
      this.pricingTable.set(config.model.toLowerCase(), config);
    }

    // Merge custom overrides
    if (customPricing) {
      for (const [key, config] of Object.entries(customPricing)) {
        this.pricingTable.set(
          this.normalizeKey(config.provider, config.model),
          config,
        );
        this.pricingTable.set(config.model.toLowerCase(), config);
      }
    }
  }

  /**
   * Registers or updates pricing configuration for a specific provider and model.
   */
  public registerPricing(config: ModelPricingConfig): void {
    this.pricingTable.set(
      this.normalizeKey(config.provider, config.model),
      config,
    );
    this.pricingTable.set(config.model.toLowerCase(), config);
  }

  /**
   * Calculates the estimated cost in USD based on actual token usage.
   * Uses token counts directly rather than character or word approximations.
   */
  public calculateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const validInputs = Math.max(0, inputTokens || 0);
    const validOutputs = Math.max(0, outputTokens || 0);

    const pricing = this.getPricing(provider, model);
    if (!pricing) {
      // Default to 0 if pricing is not configured for the model
      return 0;
    }

    const inputCost = (validInputs / 1_000_000) * pricing.inputCostPerMillion;
    const outputCost =
      (validOutputs / 1_000_000) * pricing.outputCostPerMillion;
    const totalCost = inputCost + outputCost;

    // Round to 6 decimal places to match db.Decimal(12, 6) precision
    return Math.round(totalCost * 1_000_000) / 1_000_000;
  }

  /**
   * Aggregates usage records and computes summary metrics including Cost Per Successful Answer.
   */
  public calculateSummary(records: AIUsageRecord[]): AIUsageSummary {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCostUsd = 0;
    let totalLatencyMs = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let fallbackRequests = 0;

    for (const record of records) {
      totalInputTokens += record.inputTokens || 0;
      totalOutputTokens += record.outputTokens || 0;
      totalEstimatedCostUsd += record.estimatedCostUsd || 0;
      totalLatencyMs += record.latencyMs || 0;

      if (record.status === "SUCCESS") {
        successfulRequests++;
      } else if (record.status === "FAILED") {
        failedRequests++;
      } else if (record.status === "FALLBACK") {
        fallbackRequests++;
      }
    }

    const totalRequests = records.length;
    const totalTokens = totalInputTokens + totalOutputTokens;
    const averageLatencyMs =
      totalRequests > 0 ? Math.round(totalLatencyMs / totalRequests) : 0;

    // Cost Per Successful Answer calculation
    const costPerSuccessfulAnswerUsd =
      successfulRequests > 0
        ? Math.round((totalEstimatedCostUsd / successfulRequests) * 1_000_000) /
          1_000_000
        : 0;

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      fallbackRequests,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalEstimatedCostUsd:
        Math.round(totalEstimatedCostUsd * 1_000_000) / 1_000_000,
      averageLatencyMs,
      costPerSuccessfulAnswerUsd,
    };
  }

  private getPricing(
    provider: string,
    model: string,
  ): ModelPricingConfig | undefined {
    const key = this.normalizeKey(provider, model);
    if (this.pricingTable.has(key)) {
      return this.pricingTable.get(key);
    }
    const modelKey = (model || "").toLowerCase();
    if (this.pricingTable.has(modelKey)) {
      return this.pricingTable.get(modelKey);
    }
    return undefined;
  }

  private normalizeKey(provider: string, model: string): string {
    return `${(provider || "").toLowerCase()}::${(model || "").toLowerCase()}`;
  }
}

export const defaultUsageCalculator = new AIUsageCalculator();
