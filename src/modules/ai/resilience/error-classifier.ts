import {
  AIProviderException,
  AIErrorCategory,
} from "../types/ai-provider.types.js";

/**
 * Normalized application-level AI failure classifications.
 */
export type AIFailureClassification =
  | "TRANSIENT_PROVIDER_FAILURE"
  | "NON_RETRYABLE_PROVIDER_FAILURE"
  | "PROVIDER_UNAVAILABLE"
  | "APPLICATION_VALIDATION_FAILURE"
  | "SECURITY_POLICY_VIOLATION";

export interface ClassifiedAIError {
  classification: AIFailureClassification;
  isRetryable: boolean;
  category: AIErrorCategory | "VALIDATION_ERROR" | "SECURITY_ERROR" | "UNKNOWN";
  sanitizedMessage: string;
  statusCode: number;
}

/**
 * Sensitive patterns to scrub from provider error messages before logging or propagating.
 */
const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /api[_-]?key\s*=\s*['"]?[a-zA-Z0-9_\-\.]+['"]?/gi,
  /password\s*=\s*['"]?[^'"]+['"]?/gi,
  /https?:\/\/[^\s\/$.?#].[^\s]*/gi, // scrub full endpoint urls
];

/**
 * AIErrorClassifier
 *
 * Centralized classification engine for AI and model provider errors.
 * Strictly separates retryable transient failures from non-retryable failures,
 * application validation errors, and security violations.
 */
export class AIErrorClassifier {
  /**
   * Classifies any error into a normalized ClassifiedAIError contract.
   */
  public static classify(error: unknown): ClassifiedAIError {
    if (error instanceof AIProviderException) {
      return this.classifyProviderException(error);
    }

    if (error instanceof Error) {
      return this.classifyGenericError(error);
    }

    return {
      classification: "NON_RETRYABLE_PROVIDER_FAILURE",
      isRetryable: false,
      category: "UNKNOWN",
      sanitizedMessage: "An unrecognized AI provider error occurred",
      statusCode: 500,
    };
  }

  /**
   * Determines if an error is eligible for a single transient retry.
   */
  public static isRetryable(error: unknown): boolean {
    return this.classify(error).isRetryable;
  }

  /**
   * Sanitizes an error message to prevent leaking secrets, API keys, or provider internal endpoints.
   */
  public static sanitizeErrorMessage(message: string): string {
    if (!message) return "AI operation failed";
    let sanitized = message;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
    return sanitized;
  }

  private static classifyProviderException(
    error: AIProviderException,
  ): ClassifiedAIError {
    const sanitizedMessage = this.sanitizeErrorMessage(error.message);

    switch (error.category) {
      case "TIMEOUT":
      case "RATE_LIMITED":
      case "TRANSIENT_FAILURE":
        return {
          classification: "TRANSIENT_PROVIDER_FAILURE",
          isRetryable: true,
          category: error.category,
          sanitizedMessage,
          statusCode: error.category === "RATE_LIMITED" ? 429 : 504,
        };

      case "UNAVAILABLE":
        return {
          classification: "PROVIDER_UNAVAILABLE",
          isRetryable: true, // One retry allowed before tripping fallback/circuit
          category: error.category,
          sanitizedMessage,
          statusCode: 503,
        };

      case "TOKEN_BUDGET_EXCEEDED":
      case "CONFIG_ERROR":
      case "INVALID_RESPONSE":
      case "REJECTED":
      default:
        return {
          classification: "NON_RETRYABLE_PROVIDER_FAILURE",
          isRetryable: false,
          category: error.category,
          sanitizedMessage,
          statusCode: error.category === "TOKEN_BUDGET_EXCEEDED" ? 422 : 400,
        };
    }
  }

  private static classifyGenericError(error: Error): ClassifiedAIError {
    const msg = error.message.toLowerCase();
    const sanitizedMessage = this.sanitizeErrorMessage(error.message);

    // Network / socket transient issues
    if (
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("econnrefused") ||
      msg.includes("network") ||
      msg.includes("socket hang up")
    ) {
      return {
        classification: "TRANSIENT_PROVIDER_FAILURE",
        isRetryable: true,
        category: "TRANSIENT_FAILURE",
        sanitizedMessage:
          "Transient network failure during AI provider invocation",
        statusCode: 504,
      };
    }

    // Application validation errors
    if (
      msg.includes("validation") ||
      msg.includes("zod") ||
      msg.includes("invalid input")
    ) {
      return {
        classification: "APPLICATION_VALIDATION_FAILURE",
        isRetryable: false,
        category: "VALIDATION_ERROR",
        sanitizedMessage: "Request failed structural validation",
        statusCode: 422,
      };
    }

    // Security errors
    if (
      msg.includes("unauthorized") ||
      msg.includes("forbidden") ||
      msg.includes("permission")
    ) {
      return {
        classification: "SECURITY_POLICY_VIOLATION",
        isRetryable: false,
        category: "SECURITY_ERROR",
        sanitizedMessage: "Security policy validation failed",
        statusCode: 403,
      };
    }

    return {
      classification: "NON_RETRYABLE_PROVIDER_FAILURE",
      isRetryable: false,
      category: "UNKNOWN",
      sanitizedMessage: "An unexpected error occurred during AI processing",
      statusCode: 500,
    };
  }
}
