import { AIProviderException } from "../types/ai-provider.types.js";
import { logger } from "@/shared/utils/logger.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number; // Consecutive failures to open circuit
  resetTimeoutMs: number; // Time in OPEN state before testing recovery
  halfOpenSuccessThreshold: number; // Successful probes needed in HALF_OPEN to close circuit
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private successCountInHalfOpen: number = 0;
  private lastStateChangeTime: number = Date.now();
  private readonly config: CircuitBreakerConfig;

  constructor(
    private readonly providerName: string,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 3,
      resetTimeoutMs: config?.resetTimeoutMs ?? 15000, // 15 seconds
      halfOpenSuccessThreshold: config?.halfOpenSuccessThreshold ?? 2,
    };
  }

  public getState(): CircuitState {
    this.evaluateStateTransition();
    return this.state;
  }

  /**
   * Executes an async operation with circuit-breaker protection.
   */
  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.evaluateStateTransition();

    if (this.state === "OPEN") {
      logger.warn(
        `[CircuitBreaker:${this.providerName}] Execution blocked: Circuit is OPEN`,
      );
      throw new AIProviderException(
        "UNAVAILABLE",
        `AI Provider '${this.providerName}' is currently unavailable (Circuit Breaker OPEN)`,
        this.providerName,
      );
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error: any) {
      this.onFailure(error);
      throw error;
    }
  }

  public onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCountInHalfOpen++;
      if (this.successCountInHalfOpen >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo("CLOSED");
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  public onFailure(error: any): void {
    // Only count provider-level infrastructure/transient errors toward circuit failure threshold
    if (
      error instanceof AIProviderException &&
      (error.category === "UNAVAILABLE" ||
        error.category === "TIMEOUT" ||
        error.category === "TRANSIENT_FAILURE" ||
        error.category === "RATE_LIMITED")
    ) {
      this.failureCount++;
      logger.warn(
        `[CircuitBreaker:${this.providerName}] Recorded failure count: ${this.failureCount}/${this.config.failureThreshold}`,
      );

      if (this.state === "CLOSED" && this.failureCount >= this.config.failureThreshold) {
        this.transitionTo("OPEN");
      } else if (this.state === "HALF_OPEN") {
        this.transitionTo("OPEN");
      }
    }
  }

  private evaluateStateTransition(): void {
    if (
      this.state === "OPEN" &&
      Date.now() - this.lastStateChangeTime >= this.config.resetTimeoutMs
    ) {
      this.transitionTo("HALF_OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    logger.info(
      `[CircuitBreaker:${this.providerName}] State transition: ${this.state} -> ${newState}`,
    );
    this.state = newState;
    this.lastStateChangeTime = Date.now();

    if (newState === "CLOSED") {
      this.failureCount = 0;
      this.successCountInHalfOpen = 0;
    } else if (newState === "HALF_OPEN") {
      this.successCountInHalfOpen = 0;
    }
  }

  public reset(): void {
    this.transitionTo("CLOSED");
  }
}
