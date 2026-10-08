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
import {
  IPromptManager,
  defaultPromptManager,
  PromptException,
  ManagedPrompt,
} from "../prompts/index.js";
import {
  IAIRequestValidator,
  defaultAIRequestValidator,
  AIRequestValidationException,
  ValidatedAIRequest,
} from "../validation/index.js";
import {
  IAIResponseHandler,
  defaultAIResponseHandler,
  AIResponseException,
  HandledAIResponse,
} from "../response/index.js";
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
 * 2. Prompt Management: Injected via constructor (DI), manages prompt definitions and templates.
 * 3. AI Request Validation: Injected via constructor (DI), validates request payload & context.
 * 4. AI Response Handling: Injected via constructor (DI), normalizes and validates responses.
 * 5. Data Minimization: Strictly aggregates and bounds model inputs before sending to provider.
 * 6. Candidate Plan Only: Stops at candidate typed analytical plan stage; does NOT perform
 *    semantic/policy validation, AST compilation, or SQL execution.
 * 7. Authorization Boundary: Never expands record scopes, never overrides RBAC/ABAC decisions.
 * 8. Deterministic Boundary: Does not compute authoritative business KPIs or margins.
 */
export class AIService implements IAIService {
  public readonly isAIService = true;

  constructor(
    private readonly provider: IAIProvider,
    private readonly promptManager: IPromptManager = defaultPromptManager,
    private readonly requestValidator: IAIRequestValidator = defaultAIRequestValidator,
    private readonly responseHandler: IAIResponseHandler = defaultAIResponseHandler,
  ) {}

  /**
   * Generates a candidate typed analytical plan for normalized Copilot context.
   */
  public async generateCandidatePlan(
    request: AIServiceRequest,
  ): Promise<AIServiceResult> {
    const correlationId =
      request.correlationId || `ai-req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    // 1. Validate incoming request parameters using AI Request Validation layer
    let validatedRequest: ValidatedAIRequest;
    try {
      validatedRequest = this.requestValidator.validate({
        ...request,
        correlationId,
      });
    } catch (err: unknown) {
      if (err instanceof AIRequestValidationException) {
        logger.warn(
          `[AIService] AI request validation error [correlationId: ${correlationId}, code: ${err.code}]: ${err.message}`,
        );
        const mappedCode: AIServiceErrorCode =
          err.code === "COPILOT_TOKEN_BUDGET_EXCEEDED"
            ? "COPILOT_TOKEN_BUDGET_EXCEEDED"
            : "COPILOT_INVALID_RESPONSE";
        throw new AIServiceException(
          mappedCode,
          err.message,
          {
            statusCode: err.statusCode,
            correlationId,
            details: err.details,
          },
        );
      }
      throw err;
    }

    // 2. Build provider-neutral ManagedPrompt via Prompt Management
    const promptKey = validatedRequest.promptKey;
    let managedPrompt: ManagedPrompt;
    try {
      managedPrompt = this.promptManager.buildPrompt(
        promptKey,
        {
          userQuery: validatedRequest.prompt,
          context: validatedRequest.context,
        },
        validatedRequest.promptVersion,
      );
    } catch (err: unknown) {
      if (err instanceof PromptException) {
        logger.warn(
          `[AIService] Prompt manager error [correlationId: ${correlationId}, code: ${err.code}]: ${err.message}`,
        );
        throw new AIServiceException(
          "COPILOT_PROMPT_ERROR",
          `Prompt construction failed: ${err.message}`,
          {
            statusCode: 400,
            correlationId,
            details: err.details,
          },
        );
      }
      throw err;
    }

    // 3. Token Budget Controls
    const tokenBudget = {
      maxInputTokens: validatedRequest.tokenBudget.maxInputTokens,
      maxOutputTokens: validatedRequest.tokenBudget.maxOutputTokens,
      maxConversationTokens: validatedRequest.tokenBudget.maxConversationTokens,
    };

    // 4. Construct Controlled AIProviderRequest
    const providerRequest: AIProviderRequest = {
      prompt: managedPrompt.userPrompt,
      systemInstruction: managedPrompt.systemInstruction,
      context: {
        userId: validatedRequest.context.userId,
        roleId: validatedRequest.context.roleId,
        locale: validatedRequest.context.locale || "en",
        allowedEntities: validatedRequest.context.allowedEntities
          ? [...validatedRequest.context.allowedEntities]
          : undefined,
      },
      tokenBudget,
      temperature: 0.1,
    };

    logger.info(
      `[AIService] Starting candidate plan generation [correlationId: ${correlationId}, promptKey: ${managedPrompt.metadata.promptKey}, version: ${managedPrompt.metadata.version}, role: ${request.context.roleId}]`,
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

    // 6. Process and validate response via AI Response Handling layer
    let handledResponse: HandledAIResponse;
    try {
      handledResponse = this.responseHandler.handleResponse(
        rawResponse,
        {
          correlationId,
          promptMetadata: managedPrompt.metadata,
          purpose: "CANDIDATE_PLAN",
          startTime,
        },
      );
    } catch (err: unknown) {
      if (err instanceof AIResponseException) {
        logger.error(
          `[AIService] AI response handling failed [correlationId: ${correlationId}, code: ${err.code}]: ${err.message}`,
        );
        const mappedCode: AIServiceErrorCode =
          err.code === "COPILOT_UNSAFE_AI_OUTPUT"
            ? "COPILOT_INVALID_RESPONSE"
            : err.code === "COPILOT_MALFORMED_CANDIDATE" || err.code === "COPILOT_RESPONSE_TOO_LARGE"
            ? "COPILOT_INVALID_RESPONSE"
            : "COPILOT_SERVICE_ERROR";

        throw new AIServiceException(
          mappedCode,
          err.message,
          {
            statusCode: err.statusCode,
            correlationId,
            details: err.details,
          },
        );
      }
      throw err;
    }

    // 7. Assemble normalized application-owned result from handled response
    const result: AIServiceResult = {
      candidatePlan: handledResponse.candidatePlan,
      narrative: handledResponse.narrative,
      usage: {
        provider: handledResponse.usage.providerName,
        providerName: handledResponse.usage.providerName,
        model: handledResponse.usage.modelName,
        modelName: handledResponse.usage.modelName,
        modelVersion: handledResponse.usage.modelVersion,
        inputTokens: handledResponse.usage.inputTokens,
        outputTokens: handledResponse.usage.outputTokens,
        totalTokens: handledResponse.usage.totalTokens,
        latencyMs: handledResponse.usage.latencyMs || durationMs,
        retryCount: handledResponse.usage.retryCount,
        requestOutcome: handledResponse.usage.requestOutcome,
        estimatedCostUsd: handledResponse.usage.estimatedCostUsd,
      },
      fromFallback: handledResponse.fromFallback,
      fallbackReason: handledResponse.fallbackReason,
      isDegraded: handledResponse.isDegraded,
      promptMetadata: managedPrompt.metadata,
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
