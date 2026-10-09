/**
 * AI Response Handling Error Types and Error Class.
 *
 * Normalizes all AI response failures into controlled application-level errors
 * without leaking provider-specific details, SDK stack traces, or endpoint information.
 */

export type AIResponseErrorCode =
  | "COPILOT_INVALID_RESPONSE"
  | "COPILOT_MALFORMED_CANDIDATE"
  | "COPILOT_MODEL_UNAVAILABLE"
  | "COPILOT_MODEL_DEGRADED"
  | "COPILOT_NARRATIVE_VALIDATION_FAILED"
  | "COPILOT_RESPONSE_TOO_LARGE"
  | "COPILOT_UNSAFE_AI_OUTPUT"
  | "COPILOT_SERVICE_ERROR";

export interface AIResponseExceptionOptions {
  statusCode?: number;
  isTransient?: boolean;
  correlationId?: string;
  details?: string[];
  providerName?: string;
  modelName?: string;
  cause?: unknown;
}

/**
 * Application-level exception thrown when an AI response fails structural validation,
 * contains prohibited instructions (such as executable SQL), exceeds safety bounds,
 * or represents an unrecoverable provider failure.
 */
export class AIResponseException extends Error {
  public readonly code: AIResponseErrorCode;
  public readonly statusCode: number;
  public readonly isTransient: boolean;
  public readonly correlationId?: string;
  public readonly details: string[];
  public readonly providerName?: string;
  public readonly modelName?: string;

  constructor(
    code: AIResponseErrorCode,
    message: string,
    options: AIResponseExceptionOptions = {},
  ) {
    super(message);
    this.name = "AIResponseException";
    this.code = code;
    this.correlationId = options.correlationId;
    this.details = options.details || [];
    this.providerName = options.providerName;
    this.modelName = options.modelName;

    // Determine status code if not explicitly provided
    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    } else {
      switch (code) {
        case "COPILOT_UNSAFE_AI_OUTPUT":
          this.statusCode = 400;
          break;
        case "COPILOT_INVALID_RESPONSE":
        case "COPILOT_MALFORMED_CANDIDATE":
        case "COPILOT_NARRATIVE_VALIDATION_FAILED":
        case "COPILOT_RESPONSE_TOO_LARGE":
          this.statusCode = 422;
          break;
        case "COPILOT_MODEL_DEGRADED":
        case "COPILOT_MODEL_UNAVAILABLE":
        case "COPILOT_SERVICE_ERROR":
        default:
          this.statusCode = 503;
          break;
      }
    }

    // Determine transient status if not explicitly provided
    if (options.isTransient !== undefined) {
      this.isTransient = options.isTransient;
    } else {
      this.isTransient =
        code === "COPILOT_MODEL_UNAVAILABLE" ||
        code === "COPILOT_MODEL_DEGRADED";
    }

    Object.setPrototypeOf(this, AIResponseException.prototype);
  }

  /**
   * Safe serialization for client responses: strips internal stack traces and provider internals.
   */
  public toClientResponse(): {
    error: {
      code: AIResponseErrorCode;
      message: string;
      correlationId?: string;
      details?: string[];
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.correlationId ? { correlationId: this.correlationId } : {}),
        ...(this.details.length > 0 ? { details: this.details } : {}),
      },
    };
  }
}
