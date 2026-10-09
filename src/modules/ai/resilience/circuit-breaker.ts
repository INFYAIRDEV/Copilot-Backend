import { AIProviderException } from "../types/ai-provider.types.js";
import { logger } from "@/shared/utils/logger.js";
import {
  defaultResilienceMetrics,
  AIResilienceMetrics,
} from "./resilience-metrics.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /**
   * Simple consecutive failure threshold (backward compatible).
   */
  failureThreshold?: number;

  /**
   * Operational Blueprint Trigger 1: Failures in rolling time window.
   * Default: 5 failures.
   */
  failureThresholdInWindow?: number;

  /**
   * Rolling time window duration in milliseconds.
   * Default: 60,000 ms (60 seconds).
   */
  windowMs?: number;

  /**
   * Operational Blueprint Trigger 2: Rolling call window size.
   * Default: 20 calls.
   */
  slidingWindowSize?: number;

  /**
   * Failure rate threshold across sliding window to trip circuit.
   * Default: 0.5 (50%).
   */
  slidingWindowFailureRate?: number;

  /**
   * Blueprint Open Duration: Duration in OPEN state before testing recovery.
   * Default: 300,000 ms (5 minutes).
   */
  resetTimeoutMs?: number;

  /**
   * Successful test calls needed in HALF_OPEN to close circuit.
   * Default: 2.
   */
  halfOpenSuccessThreshold?: number;

  /**
   * Optional callback when circuit trips OPEN (e.g. for operational alerting).
   */
  onCircuitOpen?: (providerName: string, reason: string) => void;
}

/**
 * CircuitBreaker
 *
 * Implements the INFYSUITE Master Blueprint v1.2 circuit-breaker specification:
 * - Triggers on:
 *   1. >= 5 failures in 60 seconds, OR
 *   2. >= 50% failures across the latest 20 calls, OR
 *   3. Configured consecutive failure threshold.
 * - Circuit opens for 5 minutes (300,000 ms).
 * - Controlled recovery via HALF_OPEN probes.
 * - Emits operational signals and logs without leaking raw payloads or credentials.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures: number = 0;
  private failureTimestamps: number[] = [];
  private rollingCalls: boolean[] = []; // true = success, false = failure
  private successCountInHalfOpen: number = 0;
  private lastStateChangeTime: number = Date.now();
  private readonly config: Required<CircuitBreakerConfig>;

  constructor(
    private readonly providerName: string,
    config?: Partial<CircuitBreakerConfig>,
    private readonly metrics: AIResilienceMetrics = defaultResilienceMetrics,
  ) {
    const defaultThreshold =
      config?.failureThreshold ?? config?.failureThresholdInWindow ?? 5;
    this.config = {
      failureThreshold: defaultThreshold,
      failureThresholdInWindow:
        config?.failureThresholdInWindow ?? defaultThreshold,
      windowMs: config?.windowMs ?? 60_000, // 60 seconds
      slidingWindowSize: config?.slidingWindowSize ?? 20,
      slidingWindowFailureRate: config?.slidingWindowFailureRate ?? 0.5, // 50%
      resetTimeoutMs: config?.resetTimeoutMs ?? 300_000, // 5 minutes
      halfOpenSuccessThreshold: config?.halfOpenSuccessThreshold ?? 2,
      onCircuitOpen: config?.onCircuitOpen ?? (() => {}),
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
        `[CircuitBreaker:${this.providerName}] Execution blocked: Circuit is OPEN (5-minute cooldown active)`,
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
    this.recordCall(true);

    if (this.state === "HALF_OPEN") {
      this.successCountInHalfOpen++;
      if (this.successCountInHalfOpen >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo("CLOSED");
      }
    } else if (this.state === "CLOSED") {
      this.consecutiveFailures = 0;
    }
  }

  public onFailure(error: any): void {
    // Only count infrastructure, timeout, or transient provider errors toward circuit opening
    const isCircuitCountingError =
      error instanceof AIProviderException &&
      (error.category === "UNAVAILABLE" ||
        error.category === "TIMEOUT" ||
        error.category === "TRANSIENT_FAILURE" ||
        error.category === "RATE_LIMITED");

    if (!isCircuitCountingError) {
      return;
    }

    const now = Date.now();
    this.consecutiveFailures++;
    this.failureTimestamps.push(now);
    this.recordCall(false);

    // Prune failure timestamps older than window
    this.pruneOldFailures(now);

    logger.warn(
      `[CircuitBreaker:${this.providerName}] Failure recorded (Consecutive: ${this.consecutiveFailures}, Recent in window: ${this.failureTimestamps.length})`,
    );

    if (this.state === "HALF_OPEN") {
      // Re-trip circuit immediately if probe fails in HALF_OPEN
      this.tripOpen("Probe failure in HALF_OPEN recovery state");
    } else if (this.state === "CLOSED") {
      // Check Blueprint Trigger 1: >= 5 failures in 60 seconds
      if (
        this.failureTimestamps.length >= this.config.failureThresholdInWindow
      ) {
        this.tripOpen(
          `Triggered threshold: ${this.failureTimestamps.length} failures in ${this.config.windowMs}ms window`,
        );
      }
      // Check Blueprint Trigger 2: >= 50% failures across latest 20 calls (min 4 calls)
      else if (this.isSlidingWindowThresholdBreached()) {
        const failurePct = Math.round(this.calculateFailureRate() * 100);
        this.tripOpen(
          `Triggered threshold: ${failurePct}% failures across latest ${this.rollingCalls.length} calls`,
        );
      }
      // Check simple consecutive failures threshold (for test / backward compatibility)
      else if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.tripOpen(
          `Triggered consecutive failures threshold: ${this.consecutiveFailures}`,
        );
      }
    }
  }

  private recordCall(success: boolean): void {
    this.rollingCalls.push(success);
    if (this.rollingCalls.length > this.config.slidingWindowSize) {
      this.rollingCalls.shift();
    }
  }

  private pruneOldFailures(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= cutoff);
  }

  private isSlidingWindowThresholdBreached(): boolean {
    if (this.rollingCalls.length < this.config.slidingWindowSize) {
      return false;
    }
    return this.calculateFailureRate() >= this.config.slidingWindowFailureRate;
  }

  private calculateFailureRate(): number {
    if (this.rollingCalls.length === 0) return 0;
    const failures = this.rollingCalls.filter((success) => !success).length;
    return failures / this.rollingCalls.length;
  }

  private tripOpen(reason: string): void {
    logger.error(
      `[CircuitBreaker:${this.providerName}] Circuit tripped OPEN for ${this.config.resetTimeoutMs}ms: ${reason}`,
    );
    this.metrics.recordCircuitOpen();
    this.config.onCircuitOpen(this.providerName, reason);
    this.transitionTo("OPEN");
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
      this.consecutiveFailures = 0;
      this.failureTimestamps = [];
      this.rollingCalls = [];
      this.successCountInHalfOpen = 0;
    } else if (newState === "HALF_OPEN") {
      this.successCountInHalfOpen = 0;
    }
  }

  public reset(): void {
    this.transitionTo("CLOSED");
  }

  public getStats() {
    this.pruneOldFailures(Date.now());
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      failuresInWindow: this.failureTimestamps.length,
      slidingWindowCalls: this.rollingCalls.length,
      slidingWindowFailureRate: this.calculateFailureRate(),
      timeInCurrentStateMs: Date.now() - this.lastStateChangeTime,
    };
  }
}
