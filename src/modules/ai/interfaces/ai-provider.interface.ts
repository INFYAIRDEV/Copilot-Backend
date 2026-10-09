import {
  AIProviderRequest,
  AIProviderResponse,
} from "../types/ai-provider.types.js";

export interface AIProviderMetadata {
  providerName: string;
  defaultModel: string;
  modelVersion?: string;
  region?: string;
  isAvailable: boolean;
}

/**
 * Provider-independent application interface for AI and LLM capabilities.
 * Domain services interact ONLY through this abstraction, preserving
 * the isolation between external provider SDKs and Copilot domain logic.
 */
export interface IAIProvider {
  /**
   * Generates a Candidate Typed Analytical Plan from normalized request context.
   */
  generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse>;

  /**
   * Optionally streams candidate response content incrementally via onChunk callback.
   */
  generateCandidatePlanStream?(
    request: AIProviderRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AIProviderResponse>;

  /**
   * Returns metadata about the current AI provider instance.
   */
  getProviderMetadata(): AIProviderMetadata;
}
