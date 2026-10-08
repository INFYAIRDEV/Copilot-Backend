/**
 * Standardized error codes for AI Request Validation failures.
 * Aligns with Copilot architecture error contracts.
 */
export type AIRequestValidationErrorCode =
  | "COPILOT_INVALID_REQUEST"
  | "COPILOT_UNSUPPORTED_OPERATION"
  | "COPILOT_INVALID_LOCALE"
  | "COPILOT_TOKEN_BUDGET_EXCEEDED"
  | "COPILOT_PROMPT_TOO_LONG"
  | "COPILOT_MISSING_CONTEXT"
  | "COPILOT_INVALID_CONTEXT"
  | "COPILOT_SECURITY_VIOLATION"
  | "COPILOT_PROMPT_INJECTION_DETECTED";

/**
 * Application-level exception thrown when an incoming AI request fails validation.
 * Distinguishes request validation errors from authentication, authorization, or provider errors.
 */
export class AIRequestValidationException extends Error {
  public readonly code: AIRequestValidationErrorCode;
  public readonly statusCode: number;
  public readonly details: string[];
  public readonly correlationId?: string;

  constructor(
    code: AIRequestValidationErrorCode,
    message: string,
    options: {
      statusCode?: number;
      details?: string[];
      correlationId?: string;
    } = {},
  ) {
    super(message);
    this.name = "AIRequestValidationException";
    this.code = code;
    this.statusCode = options.statusCode ?? (
      code === "COPILOT_TOKEN_BUDGET_EXCEEDED" ? 422 : 400
    );
    this.details = options.details || [message];
    this.correlationId = options.correlationId;

    Object.setPrototypeOf(this, AIRequestValidationException.prototype);
  }
}
