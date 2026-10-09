import {
  AIRequestInput,
  ValidatedAIRequest,
  AIRequestValidationResult,
  AIRequestValidationOptions,
  SupportedLocale,
  SUPPORTED_LOCALES,
  AI_REQUEST_LIMITS,
} from "./ai-request.types.js";
import {
  AIRequestValidationException,
  AIRequestValidationErrorCode,
} from "./ai-request.errors.js";
import { aiRequestSchema, aiOperationSchema } from "./ai-request.schema.js";
import { AIOperationType } from "../prompts/prompt.types.js";
import { logger } from "@/shared/utils/logger.js";

/**
 * Secret and credential detection patterns.
 */
const SENSITIVE_PATTERNS = [
  { pattern: /password\s*=\s*['"][^'"]+['"]/i, name: "password credential" },
  { pattern: /bearer\s+[a-zA-Z0-9_\-\.]+/i, name: "bearer token" },
  { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, name: "API key" },
  { pattern: /secret\s*=\s*['"][^'"]+['"]/i, name: "secret credential" },
  { pattern: /postgres:\/\/[^'"]+/i, name: "database connection URI" },
  { pattern: /mysql:\/\/[^'"]+/i, name: "database connection URI" },
  {
    pattern: /-----BEGIN\s+([A-Z\s]+)?PRIVATE\s+KEY-----/i,
    name: "private key",
  },
];

/**
 * Prompt injection indicators attempting to hijack system instruction roles.
 */
const INJECTION_PATTERNS = [
  /<\/?system_instruction>/i,
  /<\/?system_prompt>/i,
  /\[SYSTEM_OVERRIDE\]/i,
  /\[ADMIN_OVERRIDE\]/i,
];

/**
 * IAIRequestValidator
 *
 * Application-owned contract for validating AI requests before they enter
 * the Prompt Management and AI Service Layer.
 */
export interface IAIRequestValidator {
  /**
   * Validates an incoming AI request and returns a normalized, validated representation.
   * Throws AIRequestValidationException if validation fails.
   */
  validate(
    request: unknown,
    options?: AIRequestValidationOptions,
  ): ValidatedAIRequest;

  /**
   * Safe validation method returning validation status and collected errors without throwing.
   */
  validateSafe(
    request: unknown,
    options?: AIRequestValidationOptions,
  ): AIRequestValidationResult;
}

/**
 * AIRequestValidator
 *
 * Centralized AI Request Validation component ensuring request structural integrity,
 * normalized analytical context completeness, input-size limits, locale compliance,
 * token budget boundaries, and security sanitization.
 *
 * Architectural position:
 * Controller → Copilot Orchestration → AI Request Validation → Prompt Management → AI Service
 */
export class AIRequestValidator implements IAIRequestValidator {
  constructor(
    private readonly defaultOptions: AIRequestValidationOptions = {},
  ) {}

  /**
   * Validates incoming AI request envelope and returns a frozen ValidatedAIRequest.
   */
  public validate(
    rawRequest: unknown,
    overrideOptions: AIRequestValidationOptions = {},
  ): ValidatedAIRequest {
    const startTime = Date.now();
    const options: AIRequestValidationOptions = {
      ...this.defaultOptions,
      ...overrideOptions,
    };

    // 1. Structural schema validation via Zod
    if (!rawRequest || typeof rawRequest !== "object") {
      throw new AIRequestValidationException(
        "COPILOT_INVALID_REQUEST",
        "AI request must be a non-null object",
        { statusCode: 400 },
      );
    }

    const parseResult = aiRequestSchema.safeParse(rawRequest);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const errorPath = issue.path.join(".");
      const errorMsg = issue.message;

      // Classify error type
      let errorCode: AIRequestValidationErrorCode = "COPILOT_INVALID_REQUEST";
      let statusCode = 400;

      if (errorPath.includes("locale")) {
        errorCode = "COPILOT_INVALID_LOCALE";
      } else if (errorPath.includes("tokenBudget")) {
        errorCode = "COPILOT_TOKEN_BUDGET_EXCEEDED";
        statusCode = 422;
      } else if (errorPath === "prompt" && issue.code === "too_big") {
        errorCode = "COPILOT_PROMPT_TOO_LONG";
        statusCode = 422;
      } else if (errorPath.startsWith("context")) {
        errorCode =
          issue.code === "invalid_type" && issue.received === "undefined"
            ? "COPILOT_MISSING_CONTEXT"
            : "COPILOT_INVALID_CONTEXT";
      }

      const allDetails = parseResult.error.issues.map(
        (i) => `${i.path.join(".") || "request"}: ${i.message}`,
      );

      throw new AIRequestValidationException(
        errorCode,
        `AI request validation failed on '${errorPath}': ${errorMsg}`,
        {
          statusCode,
          details: allDetails,
          correlationId: (rawRequest as any).correlationId,
        },
      );
    }

    const data = parseResult.data;

    // 2. Validate AI Operation
    const operation = (data.operation || "CANDIDATE_PLAN").toUpperCase();
    const operationCheck = aiOperationSchema.safeParse(operation);
    if (!operationCheck.success) {
      throw new AIRequestValidationException(
        "COPILOT_UNSUPPORTED_OPERATION",
        `Unsupported AI operation '${data.operation}'. Supported: ${aiOperationSchema.options.join(", ")}`,
        {
          statusCode: 400,
          correlationId: data.correlationId,
          details: [`operation: ${data.operation} is not recognized`],
        },
      );
    }
    const validatedOperation = operationCheck.data as AIOperationType;

    // 3. Validate Locale
    const locale: SupportedLocale = (data.locale ||
      data.context.locale ||
      "en") as SupportedLocale;
    if (!SUPPORTED_LOCALES.includes(locale)) {
      throw new AIRequestValidationException(
        "COPILOT_INVALID_LOCALE",
        `Unsupported locale '${locale}'. Supported: ${SUPPORTED_LOCALES.join(", ")}`,
        {
          statusCode: 400,
          correlationId: data.correlationId,
          details: [`locale: ${locale}`],
        },
      );
    }

    // 4. Validate Token Budgets against optional custom limits
    const maxInputTokens =
      data.tokenBudget.maxInputTokens ||
      AI_REQUEST_LIMITS.DEFAULT_MAX_INPUT_TOKENS;
    const maxOutputTokens =
      data.tokenBudget.maxOutputTokens ||
      AI_REQUEST_LIMITS.DEFAULT_MAX_OUTPUT_TOKENS;
    const maxConversationTokens =
      data.tokenBudget.maxConversationTokens ||
      AI_REQUEST_LIMITS.DEFAULT_MAX_CONVERSATION_TOKENS;

    const inputLimit =
      options.maxInputTokensLimit ??
      AI_REQUEST_LIMITS.ABSOLUTE_MAX_INPUT_TOKENS;
    const outputLimit =
      options.maxOutputTokensLimit ??
      AI_REQUEST_LIMITS.ABSOLUTE_MAX_OUTPUT_TOKENS;
    const convLimit =
      options.maxConversationTokensLimit ??
      AI_REQUEST_LIMITS.ABSOLUTE_MAX_CONVERSATION_TOKENS;

    if (maxInputTokens > inputLimit) {
      throw new AIRequestValidationException(
        "COPILOT_TOKEN_BUDGET_EXCEEDED",
        `Requested maxInputTokens (${maxInputTokens}) exceeds allowed limit of ${inputLimit}`,
        { statusCode: 422, correlationId: data.correlationId },
      );
    }
    if (maxOutputTokens > outputLimit) {
      throw new AIRequestValidationException(
        "COPILOT_TOKEN_BUDGET_EXCEEDED",
        `Requested maxOutputTokens (${maxOutputTokens}) exceeds allowed limit of ${outputLimit}`,
        { statusCode: 422, correlationId: data.correlationId },
      );
    }
    if (maxConversationTokens > convLimit) {
      throw new AIRequestValidationException(
        "COPILOT_TOKEN_BUDGET_EXCEEDED",
        `Requested maxConversationTokens (${maxConversationTokens}) exceeds allowed limit of ${convLimit}`,
        { statusCode: 422, correlationId: data.correlationId },
      );
    }

    // 5. Input Minimization & Sensitive Credential Sanitization / Rejection
    let sanitizedPrompt = data.prompt;
    for (const { pattern, name } of SENSITIVE_PATTERNS) {
      if (pattern.test(data.prompt)) {
        if (options.rejectOnSensitivePatterns) {
          throw new AIRequestValidationException(
            "COPILOT_SECURITY_VIOLATION",
            `Security boundary violation: Prohibited ${name} pattern detected in AI request prompt`,
            {
              statusCode: 400,
              correlationId: data.correlationId,
              details: [`prompt contains sensitive pattern matching ${name}`],
            },
          );
        }
        sanitizedPrompt = sanitizedPrompt.replace(pattern, "[REDACTED]");
      }
    }

    // Context & Metadata must NEVER contain sensitive credentials (always rejected)
    const contextStr = JSON.stringify(data.context);
    for (const { pattern, name } of SENSITIVE_PATTERNS) {
      if (pattern.test(contextStr)) {
        throw new AIRequestValidationException(
          "COPILOT_SECURITY_VIOLATION",
          `Security boundary violation: Prohibited ${name} detected in normalized analytical context`,
          {
            statusCode: 400,
            correlationId: data.correlationId,
            details: [`context contains prohibited ${name}`],
          },
        );
      }
    }

    if (data.metadata) {
      const metadataStr = JSON.stringify(data.metadata);
      for (const { pattern, name } of SENSITIVE_PATTERNS) {
        if (pattern.test(metadataStr)) {
          throw new AIRequestValidationException(
            "COPILOT_SECURITY_VIOLATION",
            `Security boundary violation: Prohibited ${name} detected in request metadata`,
            {
              statusCode: 400,
              correlationId: data.correlationId,
              details: [`metadata contains prohibited ${name}`],
            },
          );
        }
      }
    }

    // 6. Prompt Injection Boundary Check
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(data.prompt)) {
        throw new AIRequestValidationException(
          "COPILOT_PROMPT_INJECTION_DETECTED",
          "Security boundary violation: Attempted system prompt instruction override detected",
          {
            statusCode: 400,
            correlationId: data.correlationId,
            details: ["prompt contains prohibited system override tags"],
          },
        );
      }
    }

    // 7. Conversation Reference Structure Check (if provided)
    if (
      data.conversationId !== undefined &&
      data.conversationId.trim().length === 0
    ) {
      throw new AIRequestValidationException(
        "COPILOT_INVALID_REQUEST",
        "conversationId cannot be an empty string if provided",
        { statusCode: 400, correlationId: data.correlationId },
      );
    }

    // 8. Assemble immutable, application-owned ValidatedAIRequest
    const correlationId =
      data.correlationId ||
      `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const durationMs = Date.now() - startTime;
    logger.info(
      `[AIRequestValidator] Request validated successfully [correlationId: ${correlationId}, operation: ${validatedOperation}, role: ${data.context.roleId}, duration: ${durationMs}ms]`,
    );

    const validated: ValidatedAIRequest = Object.freeze({
      prompt: sanitizedPrompt,
      context: Object.freeze({
        userId: data.context.userId,
        roleId: data.context.roleId,
        locale,
        conversationId: data.conversationId || data.context.conversationId,
        allowedEntities: data.context.allowedEntities
          ? [...data.context.allowedEntities]
          : undefined,
        datasetContext: data.context.datasetContext
          ? {
              datasetId: data.context.datasetContext.datasetId,
              availableMetrics: data.context.datasetContext.availableMetrics
                ? [...data.context.datasetContext.availableMetrics]
                : undefined,
              availableDimensions: data.context.datasetContext
                .availableDimensions
                ? [...data.context.datasetContext.availableDimensions]
                : undefined,
            }
          : undefined,
      }),
      operation: validatedOperation,
      promptKey: data.promptKey || "CANDIDATE_ANALYTICAL_PLAN",
      promptVersion: data.promptVersion,
      locale,
      tokenBudget: Object.freeze({
        maxInputTokens,
        maxOutputTokens,
        maxConversationTokens,
      }),
      correlationId,
      conversationId: data.conversationId || data.context.conversationId,
      metadata: data.metadata ? Object.freeze({ ...data.metadata }) : undefined,
      validatedAt: new Date().toISOString(),
    });

    return validated;
  }

  /**
   * Safe validation method that returns result object rather than throwing.
   */
  public validateSafe(
    rawRequest: unknown,
    options?: AIRequestValidationOptions,
  ): AIRequestValidationResult {
    try {
      const validated = this.validate(rawRequest, options);
      return {
        isValid: true,
        validatedRequest: validated,
        errors: [],
      };
    } catch (err: unknown) {
      if (err instanceof AIRequestValidationException) {
        return {
          isValid: false,
          errors: err.details,
        };
      }
      return {
        isValid: false,
        errors: [
          err instanceof Error ? err.message : "Unknown validation failure",
        ],
      };
    }
  }
}

export const defaultAIRequestValidator = new AIRequestValidator();
