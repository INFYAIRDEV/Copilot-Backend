import { AIProviderException } from "@/modules/ai/types/ai-provider.types.js";

export interface LLMProviderConfig {
  apiKey?: string;
  endpointUrl: string;
  modelIdentifier: string;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxConversationTokens: number;
  region: string;
  environment: string;
}

export class LLMConfigManager {
  private static cachedConfig: LLMProviderConfig | null = null;

  /**
   * Loads and validates LLM provider configuration from environment variables.
   * Throws AIProviderException("CONFIG_ERROR") if mandatory settings are missing.
   * Secret values are NEVER included in error messages or logs.
   */
  public static getConfig(): LLMProviderConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const apiKey =
      process.env.AI_PROVIDER_API_KEY || process.env.GEMINI_API_KEY;
    const endpointUrl =
      process.env.AI_PROVIDER_ENDPOINT_URL ||
      process.env.AI_PROVIDER_ENDPOINT ||
      "https://generativelanguage.googleapis.com/v1beta";
    const modelIdentifier =
      process.env.AI_PROVIDER_MODEL_IDENTIFIER ||
      process.env.AI_PROVIDER_MODEL ||
      "gemini-3.8-flash";
    const timeoutMs = parseInt(
      process.env.AI_PROVIDER_TIMEOUT_MS || "8000",
      10,
    );
    const maxInputTokens = parseInt(
      process.env.AI_MAX_INPUT_TOKENS || "4096",
      10,
    );
    const maxOutputTokens = parseInt(
      process.env.AI_MAX_OUTPUT_TOKENS || "2048",
      10,
    );
    const maxConversationTokens = parseInt(
      process.env.AI_MAX_CONVERSATION_TOKENS || "8192",
      10,
    );
    const region = process.env.AI_PROVIDER_REGION || "us-central1";
    const environment = process.env.NODE_ENV || "development";

    // Validate mandatory parameters for non-test environments
    if (!apiKey && environment === "production") {
      throw new AIProviderException(
        "CONFIG_ERROR",
        "Mandatory AI provider API key is not configured in environment variables",
        "LLM_PROVIDER",
      );
    }

    if (isNaN(timeoutMs) || timeoutMs <= 0) {
      throw new AIProviderException(
        "CONFIG_ERROR",
        "Invalid AI_PROVIDER_TIMEOUT_MS configuration",
        "LLM_PROVIDER",
      );
    }

    this.cachedConfig = {
      apiKey: apiKey || "mock-dev-key",
      endpointUrl,
      modelIdentifier,
      timeoutMs,
      maxInputTokens,
      maxOutputTokens,
      maxConversationTokens,
      region,
      environment,
    };

    return this.cachedConfig;
  }

  public static clearCache(): void {
    this.cachedConfig = null;
  }
}
