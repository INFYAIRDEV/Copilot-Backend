/**
 * Snapshot of resilience metrics for monitoring, dashboards, and alerting.
 */
export interface AIResilienceMetricsSnapshot {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  transientFailures: number;
  nonTransientFailures: number;
  retriesAttempted: number;
  retriesSucceeded: number;
  retriesFailed: number;
  circuitOpenEvents: number;
  fallbackCount: number;
  degradedResponses: number;
  averageLatencyMs: number;
}

/**
 * AIResilienceMetrics
 *
 * Centralized collector tracking model failures, retries, circuit breaker events,
 * and degraded responses for operational monitoring and incident response.
 */
export class AIResilienceMetrics {
  private totalRequests: number = 0;
  private successRequests: number = 0;
  private failedRequests: number = 0;
  private transientFailures: number = 0;
  private nonTransientFailures: number = 0;
  private retriesAttempted: number = 0;
  private retriesSucceeded: number = 0;
  private retriesFailed: number = 0;
  private circuitOpenEvents: number = 0;
  private fallbackCount: number = 0;
  private degradedResponses: number = 0;
  private totalLatencyMs: number = 0;

  public recordRequest(): void {
    this.totalRequests++;
  }

  public recordSuccess(latencyMs: number): void {
    this.successRequests++;
    this.totalLatencyMs += latencyMs;
  }

  public recordFailure(isTransient: boolean): void {
    this.failedRequests++;
    if (isTransient) {
      this.transientFailures++;
    } else {
      this.nonTransientFailures++;
    }
  }

  public recordRetry(succeeded: boolean): void {
    this.retriesAttempted++;
    if (succeeded) {
      this.retriesSucceeded++;
    } else {
      this.retriesFailed++;
    }
  }

  public recordCircuitOpen(): void {
    this.circuitOpenEvents++;
  }

  public recordFallback(): void {
    this.fallbackCount++;
  }

  public recordDegraded(): void {
    this.degradedResponses++;
  }

  public getSnapshot(): AIResilienceMetricsSnapshot {
    return {
      totalRequests: this.totalRequests,
      successRequests: this.successRequests,
      failedRequests: this.failedRequests,
      transientFailures: this.transientFailures,
      nonTransientFailures: this.nonTransientFailures,
      retriesAttempted: this.retriesAttempted,
      retriesSucceeded: this.retriesSucceeded,
      retriesFailed: this.retriesFailed,
      circuitOpenEvents: this.circuitOpenEvents,
      fallbackCount: this.fallbackCount,
      degradedResponses: this.degradedResponses,
      averageLatencyMs:
        this.successRequests > 0
          ? Math.round(this.totalLatencyMs / this.successRequests)
          : 0,
    };
  }

  public reset(): void {
    this.totalRequests = 0;
    this.successRequests = 0;
    this.failedRequests = 0;
    this.transientFailures = 0;
    this.nonTransientFailures = 0;
    this.retriesAttempted = 0;
    this.retriesSucceeded = 0;
    this.retriesFailed = 0;
    this.circuitOpenEvents = 0;
    this.fallbackCount = 0;
    this.degradedResponses = 0;
    this.totalLatencyMs = 0;
  }
}

export const defaultResilienceMetrics = new AIResilienceMetrics();
