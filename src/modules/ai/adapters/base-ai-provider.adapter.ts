import { IAIProvider, AIProviderMetadata } from "../interfaces/ai-provider.interface.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  AIProviderException,
  AIErrorCategory,
} from "../types/ai-provider.types.js";

export abstract class BaseAIProviderAdapter implements IAIProvider {
  protected constructor(protected readonly metadata: AIProviderMetadata) {}

  public getProviderMetadata(): AIProviderMetadata {
    return this.metadata;
  }

  public abstract generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse>;

  /**
   * Translates external SDK error types into application-defined AIProviderException.
   */
  protected normalizeError(error: any): AIProviderException {
    if (error instanceof AIProviderException) {
      return error;
    }

    const message = error?.message || "Unknown external AI provider error";
    const fullErrorStr = `${message} ${error?.code || ""} ${error?.status || ""} ${error?.name || ""}`.toLowerCase();

    let category: AIErrorCategory = "TRANSIENT_FAILURE";

    if (fullErrorStr.includes("timeout") || fullErrorStr.includes("etimedout") || fullErrorStr.includes("abort")) {
      category = "TIMEOUT";
    } else if (fullErrorStr.includes("429") || fullErrorStr.includes("rate") || fullErrorStr.includes("quota")) {
      category = "RATE_LIMITED";
    } else if (fullErrorStr.includes("503") || fullErrorStr.includes("502") || fullErrorStr.includes("unavailable")) {
      category = "UNAVAILABLE";
    } else if (fullErrorStr.includes("401") || fullErrorStr.includes("403") || fullErrorStr.includes("auth") || fullErrorStr.includes("key")) {
      category = "CONFIG_ERROR";
    } else if (fullErrorStr.includes("400") || fullErrorStr.includes("invalid") || fullErrorStr.includes("reject") || fullErrorStr.includes("bad request")) {
      category = "REJECTED";
    }

    return new AIProviderException(
      category,
      `[${this.metadata.providerName}] ${message}`,
      this.metadata.providerName,
      error,
    );
  }
}
