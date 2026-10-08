import { IAIProvider, AIProviderMetadata } from "../interfaces/ai-provider.interface.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  AIProviderException,
  AIUsageTelemetry,
} from "../types/ai-provider.types.js";
import { CircuitBreaker, CircuitBreakerConfig } from "./circuit-breaker.js";
import { structuredFallbackProvider } from "../fallback/structured-fallback.js";
import { AIErrorClassifier } from "./error-classifier.js";
import { defaultResilienceMetrics, AIResilienceMetrics } from "./resilience-metrics.js";
import { logger } from "@/shared/utils/logger.js";

export interface ResilientAIProviderOptions {
  circuitConfig?: Partial<CircuitBreakerConfig>;
  fallbackProvider?: IAIProvider;
  retryBackoffMs?: number;
  metrics?: AIResilienceMetrics;
}

/**
 * ResilientAIProvider
 *
 * Implements the AI Error and Retry Handling layer according to the Master Blueprint:
 * 1. Single retry policy: EXACTLY AT MOST ONE retry for transient provider errors.
 * 2. Non-transient errors (invalid request, token budget, rejected, config errors) are NEVER retried.
 * 3. Circuit breaker protecting against provider outages (>=5 failures in 60s, or >=50% in 20 calls).
 * 4. Structured deterministic fallback when circuit is OPEN or provider is unavailable.
 * 5. Full observability metrics (requests, retries, failures, latency, circuit-open events).
 * 6. Data minimization in logs: NEVER logs user questions, credentials, or raw payloads.
 */
export class ResilientAIProvider implements IAIProvider {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly fallbackProvider: IAIProvider;
  private readonly retryBackoffMs: number;
  private readonly metrics: AIResilienceMetrics;

  constructor(
    private readonly primaryProvider: IAIProvider,
    fallbackProvider?: IAIProvider,
    circuitConfig?: Partial<CircuitBreakerConfig>,
    options?: Partial<ResilientAIProviderOptions>,
  ) {
    const metadata = primaryProvider.getProviderMetadata();
    this.metrics = options?.metrics || defaultResilienceMetrics;
    this.circuitBreaker = new CircuitBreaker(
      metadata.providerName,
      options?.circuitConfig || circuitConfig,
      this.metrics,
    );
    this.fallbackProvider =
      options?.fallbackProvider || fallbackProvider || structuredFallbackProvider;
    this.retryBackoffMs = options?.retryBackoffMs ?? 50; // Bounded backoff
  }

  public getProviderMetadata(): AIProviderMetadata {
    const primaryMeta = this.primaryProvider.getProviderMetadata();
    const circuitState = this.circuitBreaker.getState();
    return {
      ...primaryMeta,
      isAvailable: primaryMeta.isAvailable && circuitState !== "OPEN",
    };
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public getMetrics(): AIResilienceMetrics {
    return this.metrics;
  }

  public async generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    this.metrics.recordRequest();

    // 1. Enforce Token Budget Controls before outbound API call
    this.enforceTokenBudget(request);

    const circuitState = this.circuitBreaker.getState();

    // 2. If Circuit is OPEN, route directly to Structured Fallback without calling provider
    if (circuitState === "OPEN") {
      logger.warn(
        `[ResilientAIProvider:${this.primaryProvider.getProviderMetadata().providerName}] Circuit is OPEN. Executing Structured Fallback.`,
      );
      return this.executeFallback(
        request,
        "Circuit breaker is OPEN due to repeated provider failures",
      );
    }

    // 3. Execute Primary Provider with Circuit Breaker and STRICT SINGLE RETRY policy
    let retryCount = 0;
    const startTime = Date.now();
    const providerName = this.primaryProvider.getProviderMetadata().providerName;

    try {
      const response = await this.circuitBreaker.execute(async () => {
        try {
          // Attempt 1: Initial call
          return await this.primaryProvider.generateCandidatePlan(request);
        } catch (error: any) {
          const classified = AIErrorClassifier.classify(error);

          // Blueprint Rule: EXACTLY ONE RETRY for transient errors only
          if (classified.isRetryable && retryCount < 1) {
            retryCount++;
            logger.warn(
              `[ResilientAIProvider:${providerName}] Transient failure encountered [Category: ${classified.category}]. Retrying (Attempt ${retryCount}/1)...`,
            );

            // Bounded backoff
            if (this.retryBackoffMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs));
            }

            try {
              // Attempt 2: The single permitted retry
              const retryResponse = await this.primaryProvider.generateCandidatePlan(request);
              this.metrics.recordRetry(true);
              return retryResponse;
            } catch (retryError: any) {
              this.metrics.recordRetry(false);
              // Normalize error on retry failure
              throw this.normalizeError(retryError, providerName);
            }
          }

          // Non-transient or retry already exhausted -> do NOT retry
          throw this.normalizeError(error, providerName);
        }
      });

      const latencyMs = Date.now() - startTime;
      this.metrics.recordSuccess(latencyMs);

      const updatedUsage: AIUsageTelemetry = {
        ...response.usage,
        retryCount,
        latencyMs,
      };

      this.logTelemetry(updatedUsage);

      return {
        ...response,
        usage: updatedUsage,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      const normalizedError = this.normalizeError(error, providerName);
      const isTransient = normalizedError.isTransient;

      this.metrics.recordFailure(isTransient);

      logger.error(
        `[ResilientAIProvider:${providerName}] Provider execution failed [Category: ${normalizedError.category}, Latency: ${latencyMs}ms]: ${AIErrorClassifier.sanitizeErrorMessage(normalizedError.message)}`,
      );

      // Routing to structured fallback if provider outage / transient failure
      if (
        normalizedError.category === "UNAVAILABLE" ||
        normalizedError.category === "TIMEOUT" ||
        normalizedError.category === "TRANSIENT_FAILURE" ||
        normalizedError.category === "RATE_LIMITED"
      ) {
        return this.executeFallback(request, normalizedError.message);
      }

      // Non-transient errors (e.g. TOKEN_BUDGET_EXCEEDED, REJECTED, CONFIG_ERROR) are re-thrown
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
    this.metrics.recordFallback();
    const fallbackResponse = await this.fallbackProvider.generateCandidatePlan(request);
    return {
      ...fallbackResponse,
      fromFallback: true,
      fallbackReason: reason,
    };
  }

  private normalizeError(error: any, providerName: string): AIProviderException {
    if (error instanceof AIProviderException) {
      return error;
    }
    const classified = AIErrorClassifier.classify(error);
    const category =
      classified.category === "VALIDATION_ERROR" ||
      classified.category === "SECURITY_ERROR" ||
      classified.category === "UNKNOWN"
        ? "TRANSIENT_FAILURE"
        : classified.category;

    return new AIProviderException(
      category,
      classified.sanitizedMessage,
      providerName,
      error,
    );
  }

  /**
   * Observability telemetry logger: excludes prompt text and sensitive secrets.
   */
  private logTelemetry(telemetry: AIUsageTelemetry): void {
    logger.info(
      `[AI-Telemetry] Provider: ${telemetry.providerName} | Model: ${telemetry.modelName} | Tokens: ${telemetry.totalTokens} (In: ${telemetry.inputTokens}, Out: ${telemetry.outputTokens}) | Latency: ${telemetry.latencyMs}ms | Retries: ${telemetry.retryCount} | Est.Cost: $${telemetry.estimatedCostUsd ?? 0}`,
    );
  }
}
