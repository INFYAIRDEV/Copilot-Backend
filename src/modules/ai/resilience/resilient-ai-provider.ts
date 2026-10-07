import { IAIProvider, AIProviderMetadata } from "../interfaces/ai-provider.interface.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  AIProviderException,
  AIUsageTelemetry,
} from "../types/ai-provider.types.js";
import { CircuitBreaker, CircuitBreakerConfig } from "./circuit-breaker.js";
import { structuredFallbackProvider, StructuredFallbackProvider } from "../fallback/structured-fallback.js";
import { logger } from "@/shared/utils/logger.js";

export class ResilientAIProvider implements IAIProvider {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly fallbackProvider: IAIProvider;

  constructor(
    private readonly primaryProvider: IAIProvider,
    fallbackProvider?: IAIProvider,
    circuitConfig?: Partial<CircuitBreakerConfig>,
  ) {
    const metadata = primaryProvider.getProviderMetadata();
    this.circuitBreaker = new CircuitBreaker(metadata.providerName, circuitConfig);
    this.fallbackProvider = fallbackProvider || structuredFallbackProvider;
  }

  public getProviderMetadata(): AIProviderMetadata {
    const primaryMeta = this.primaryProvider.getProviderMetadata();
    const circuitState = this.circuitBreaker.getState();
    return {
      ...primaryMeta,
      isAvailable: primaryMeta.isAvailable && circuitState !== "OPEN",
    };
  }

  public async generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    // 1. Enforce Application Token Budget Controls prior to provider request
    this.enforceTokenBudget(request);

    const circuitState = this.circuitBreaker.getState();

    // 2. If Circuit is OPEN, route directly to Structured Fallback
    if (circuitState === "OPEN") {
      logger.warn(
        `[ResilientAIProvider:${this.primaryProvider.getProviderMetadata().providerName}] Circuit is OPEN. Executing Structured Fallback.`,
      );
      return this.executeFallback(
        request,
        "Circuit breaker is OPEN due to repeated provider failures",
      );
    }

    // 3. Execute Primary Provider with Circuit Breaker and Single Retry Policy
    let retryCount = 0;
    const startTime = Date.now();

    try {
      const response = await this.circuitBreaker.execute(async () => {
        try {
          return await this.primaryProvider.generateCandidatePlan(request);
        } catch (error: any) {
          const normalizedError =
            error instanceof AIProviderException
              ? error
              : new AIProviderException("TRANSIENT_FAILURE", error?.message || "Provider call failed", this.primaryProvider.getProviderMetadata().providerName, error);

          // Requirement 10: Allow ONLY ONE retry for transient errors
          if (normalizedError.isTransient && retryCount < 1) {
            retryCount++;
            logger.warn(
              `[ResilientAIProvider:${this.primaryProvider.getProviderMetadata().providerName}] Transient failure encountered: "${normalizedError.message}". Retrying (Attempt ${retryCount}/1)...`,
            );
            return await this.primaryProvider.generateCandidatePlan(request);
          }

          throw normalizedError;
        }
      });

      // Update telemetry with actual retry count
      const updatedUsage: AIUsageTelemetry = {
        ...response.usage,
        retryCount,
        latencyMs: Date.now() - startTime,
      };

      this.logTelemetry(updatedUsage);

      return {
        ...response,
        usage: updatedUsage,
      };
    } catch (error: any) {
      const normalizedError =
        error instanceof AIProviderException
          ? error
          : new AIProviderException("UNAVAILABLE", error?.message || "Unhandled provider failure", this.primaryProvider.getProviderMetadata().providerName, error);

      logger.error(
        `[ResilientAIProvider:${this.primaryProvider.getProviderMetadata().providerName}] Provider execution failed [Category: ${normalizedError.category}]: ${normalizedError.message}`,
      );

      // Requirement 8: Fallback on provider unavailability / transient failure
      if (
        normalizedError.category === "UNAVAILABLE" ||
        normalizedError.category === "TIMEOUT" ||
        normalizedError.category === "TRANSIENT_FAILURE" ||
        normalizedError.category === "RATE_LIMITED"
      ) {
        return this.executeFallback(request, normalizedError.message);
      }

      // Non-transient errors (e.g. TOKEN_BUDGET_EXCEEDED, CONFIG_ERROR) are re-thrown as application exceptions
      throw normalizedError;
    }
  }

  /**
   * Pre-validates token budget limits before outbound API call.
   */
  private enforceTokenBudget(request: AIProviderRequest): void {
    if (!request.tokenBudget) return;

    const estimatedInputTokens = Math.ceil(request.prompt.length / 4);

    if (
      request.tokenBudget.maxInputTokens &&
      estimatedInputTokens > request.tokenBudget.maxInputTokens
    ) {
      throw new AIProviderException(
        "TOKEN_BUDGET_EXCEEDED",
        `Input prompt token estimate (${estimatedInputTokens}) exceeds max input token budget (${request.tokenBudget.maxInputTokens})`,
        this.primaryProvider.getProviderMetadata().providerName,
      );
    }
  }

  /**
   * Executes the structured fallback provider path.
   */
  private async executeFallback(
    request: AIProviderRequest,
    reason: string,
  ): Promise<AIProviderResponse> {
    const fallbackResponse = await this.fallbackProvider.generateCandidatePlan(request);
    return {
      ...fallbackResponse,
      fromFallback: true,
      fallbackReason: reason,
    };
  }

  /**
   * Observability telemetry logger for tracking cost, latency, retries, and token usage.
   */
  private logTelemetry(telemetry: AIUsageTelemetry): void {
    logger.info(
      `[AI-Telemetry] Provider: ${telemetry.providerName} | Model: ${telemetry.modelName} | Tokens: ${telemetry.totalTokens} (In: ${telemetry.inputTokens}, Out: ${telemetry.outputTokens}) | Latency: ${telemetry.latencyMs}ms | Retries: ${telemetry.retryCount} | Est.Cost: $${telemetry.estimatedCostUsd ?? 0}`,
    );
  }
}
