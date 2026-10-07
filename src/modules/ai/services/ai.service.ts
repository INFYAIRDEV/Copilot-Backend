import { IAIService } from "../interfaces/ai-service.interface.js";
import { IAIProvider } from "../interfaces/ai-provider.interface.js";
import {
  AIServiceRequest,
  AIServiceResult,
  AIServiceException,
  AIServiceErrorCode,
} from "../types/ai-service.types.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  AIProviderException,
  AIErrorCategory,
} from "../types/ai-provider.types.js";
import { CandidatePlanValidator } from "../validation/candidate-plan.validator.js";
import { logger } from "@/shared/utils/logger.js";

/**
 * Secret / credential sanitization patterns for model input minimization.
 */
const SENSITIVE_PATTERNS = [
  /password\s*=\s*['"][^'"]+['"]/gi,
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /api[_-]?key\s*=\s*['"][^'"]+['"]/gi,
  /secret\s*=\s*['"][^'"]+['"]/gi,
  /postgres:\/\/[^'"]+/gi,
  /mysql:\/\/[^'"]+/gi,
];

/**
 * AIService
 *
 * Application-level AI Service Layer coordinating AI operations between Copilot
 * domain workflows and the AI Provider Abstraction Layer.
 *
 * Sits in the architecture:
 * Controller → Copilot Application Service → AIService → IAIProvider → LLM Provider
 *
 * Strict Boundaries:
 * 1. AI Provider Abstraction: Injected via constructor (DI), never calls provider SDKs directly.
 * 2. Data Minimization: Strictly aggregates and bounds model inputs before sending to provider.
 * 3. Candidate Plan Only: Stops at candidate typed analytical plan stage; does NOT perform
 *    semantic/policy validation, AST compilation, or SQL execution.
 * 4. Authorization Boundary: Never expands record scopes, never overrides RBAC/ABAC decisions.
 * 5. Deterministic Boundary: Does not compute authoritative business KPIs or margins.
 */
export class AIService implements IAIService {
  public readonly isAIService = true;

  constructor(private readonly provider: IAIProvider) {}

  /**
   * Generates a candidate typed analytical plan for normalized Copilot context.
   */
  public async generateCandidatePlan(
    request: AIServiceRequest,
  ): Promise<AIServiceResult> {
    const correlationId =
      request.correlationId || `ai-req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    // 1. Validate incoming request parameters
    if (!request.prompt || typeof request.prompt !== "string" || request.prompt.trim().length === 0) {
      throw new AIServiceException(
        "COPILOT_INVALID_RESPONSE",
        "Request prompt cannot be empty",
        { statusCode: 400, correlationId },
      );
    }

    if (!request.context || typeof request.context.userId !== "number" || !request.context.roleId) {
      throw new AIServiceException(
        "COPILOT_INVALID_RESPONSE",
        "Request context must contain valid userId and roleId",
        { statusCode: 400, correlationId },
      );
    }

    // 2. Data Minimization & Input Sanitization
    const sanitizedPrompt = this.sanitizeInput(request.prompt);

    // 3. Token Budget Controls
    const tokenBudget = {
      maxInputTokens: request.tokenBudget?.maxInputTokens ?? 2048,
      maxOutputTokens: request.tokenBudget?.maxOutputTokens ?? 1024,
      maxConversationTokens: request.tokenBudget?.maxConversationTokens ?? 4096,
    };

    // 4. Construct Controlled AIProviderRequest
    const providerRequest: AIProviderRequest = {
      prompt: sanitizedPrompt,
      context: {
        userId: request.context.userId,
        roleId: request.context.roleId,
        locale: request.context.locale || "en",
        allowedEntities: request.context.allowedEntities,
      },
      tokenBudget,
      temperature: 0.1,
    };

    logger.info(
      `[AIService] Starting candidate plan generation [correlationId: ${correlationId}, role: ${request.context.roleId}]`,
    );

    let rawResponse: AIProviderResponse;

    try {
      // 5. Invoke AI Provider Abstraction (includes retry & circuit breaker mechanics)
      rawResponse = await this.provider.generateCandidatePlan(providerRequest);
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      throw this.handleProviderFailure(error, correlationId, durationMs);
    }

    const durationMs = Date.now() - startTime;

    // 6. Validate structural integrity of the candidate response
    const structuralValidation = CandidatePlanValidator.validate(
      rawResponse.candidatePlan,
    );

    if (!structuralValidation.isValid) {
      logger.error(
        `[AIService] Structural validation failed for candidate plan [correlationId: ${correlationId}]: ${structuralValidation.errors.join("; ")}`,
      );
      throw new AIServiceException(
        "COPILOT_INVALID_RESPONSE",
        "Candidate analytical plan failed structural integrity validation",
        {
          statusCode: 422,
          correlationId,
          details: structuralValidation.errors,
        },
      );
    }

    // 7. Determine request outcome for operational telemetry
    const requestOutcome = rawResponse.fromFallback ? "FALLBACK" : "SUCCESS";

    // 8. Assemble normalized application-owned result
    const result: AIServiceResult = {
      candidatePlan: rawResponse.candidatePlan,
      narrative: rawResponse.narrative,
      usage: {
        provider: rawResponse.usage.providerName,
        providerName: rawResponse.usage.providerName,
        model: rawResponse.usage.modelName,
        modelName: rawResponse.usage.modelName,
        modelVersion: rawResponse.usage.modelVersion,
        inputTokens: rawResponse.usage.inputTokens,
        outputTokens: rawResponse.usage.outputTokens,
        totalTokens: rawResponse.usage.totalTokens,
        latencyMs: rawResponse.usage.latencyMs || durationMs,
        retryCount: rawResponse.usage.retryCount,
        requestOutcome,
        estimatedCostUsd: rawResponse.usage.estimatedCostUsd,
      },
      fromFallback: rawResponse.fromFallback,
      fallbackReason: rawResponse.fallbackReason,
      isDegraded: rawResponse.fromFallback,
      correlationId,
    };

    logger.info(
      `[AIService] Candidate plan completed [correlationId: ${correlationId}, provider: ${result.usage.provider}, outcome: ${result.usage.requestOutcome}, duration: ${durationMs}ms]`,
    );

    return result;
  }

  /**
   * Sanitizes input to prevent credential leakage or injection into the model context.
   */
  private sanitizeInput(prompt: string): string {
    let sanitized = prompt;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
    return sanitized;
  }

  /**
   * Translates AI provider errors into application-level AIServiceExceptions
   * without leaking provider SDK details, API keys, or raw stack traces.
   */
  private handleProviderFailure(
    error: unknown,
    correlationId: string,
    durationMs: number,
  ): AIServiceException {
    if (error instanceof AIProviderException) {
      logger.warn(
        `[AIService] Provider error encountered [correlationId: ${correlationId}, category: ${error.category}, duration: ${durationMs}ms]: ${error.message}`,
      );

      const mappedCode = this.mapCategoryToErrorCode(error.category);
      const isTransient = error.isTransient;
      const statusCode =
        error.category === "TOKEN_BUDGET_EXCEEDED" ? 422 :
        error.category === "INVALID_RESPONSE" ? 422 : 503;

      const clientMessage =
        error.category === "TOKEN_BUDGET_EXCEEDED"
          ? "Request exceeds the configured token budget limits"
          : error.category === "TIMEOUT"
          ? "AI provider timed out while generating candidate plan"
          : error.category === "INVALID_RESPONSE"
          ? "Malformed response received from AI provider"
          : "The AI service is temporarily unavailable. Certified reports remain available.";

      return new AIServiceException(mappedCode, clientMessage, {
        statusCode,
        isTransient,
        correlationId,
      });
    }

    if (error instanceof AIServiceException) {
      return error;
    }

    // Unhandled / unexpected exception
    const errMessage = error instanceof Error ? error.message : "Internal AI service failure";
    logger.error(
      `[AIService] Unexpected error in AI Service [correlationId: ${correlationId}, duration: ${durationMs}ms]: ${errMessage}`,
    );

    return new AIServiceException(
      "COPILOT_SERVICE_ERROR",
      "An unexpected error occurred during AI processing",
      {
        statusCode: 500,
        isTransient: false,
        correlationId,
      },
    );
  }

  /**
   * Maps AIErrorCategory to normalized application-level AIServiceErrorCode.
   */
  private mapCategoryToErrorCode(category: AIErrorCategory): AIServiceErrorCode {
    switch (category) {
      case "TIMEOUT":
        return "COPILOT_MODEL_TIMEOUT";
      case "UNAVAILABLE":
        return "COPILOT_MODEL_UNAVAILABLE";
      case "TOKEN_BUDGET_EXCEEDED":
        return "COPILOT_TOKEN_BUDGET_EXCEEDED";
      case "INVALID_RESPONSE":
        return "COPILOT_INVALID_RESPONSE";
      case "CONFIG_ERROR":
        return "COPILOT_CONFIG_ERROR";
      case "RATE_LIMITED":
      case "TRANSIENT_FAILURE":
      case "REJECTED":
      default:
        return "COPILOT_MODEL_UNAVAILABLE";
    }
  }
}
