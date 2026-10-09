import { IAIService } from "../interfaces/ai-service.interface.js";
import { IAIProvider } from "../interfaces/ai-provider.interface.js";
import {
  AIServiceRequest,
  AIServiceResult,
  AIServiceException,
  AIServiceErrorCode,
  NormalizedAnalyticalContext,
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
import { IAIUsageService, defaultUsageService } from "../usage/index.js";
import { logger } from "../../../shared/utils/logger.js";
import {
  OutputSchemaRegistry,
  OutputSchemaException,
} from "../structured/structured-output.registry.js";
import { defaultOutputSchemaRegistry } from "../structured/output-schema.catalog.js";
import { validateStructuredOutput } from "../structured/structured-output.validator.js";
import {
  OutputSchemaDefinition,
  StructuredOutputResult,
} from "../structured/structured-output.types.js";
import { LLMConfigManager } from "@/infrastructure/ai/llm-config.js";

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
 * 5. AI Usage Tracking: Injected via constructor (DI), tracks token metrics and model costs.
 * 6. Data Minimization: Strictly aggregates and bounds model inputs before sending to provider.
 * 7. Candidate Plan Only: Stops at candidate typed analytical plan stage; does NOT perform
 *    semantic/policy validation, AST compilation, or SQL execution.
 * 8. Authorization Boundary: Never expands record scopes, never overrides RBAC/ABAC decisions.
 * 9. Deterministic Boundary: Does not compute authoritative business KPIs or margins.
 */
export class AIService implements IAIService {
  public readonly isAIService = true;

  constructor(
    private readonly provider: IAIProvider,
    private readonly promptManager: IPromptManager = defaultPromptManager,
    private readonly requestValidator: IAIRequestValidator = defaultAIRequestValidator,
    private readonly responseHandler: IAIResponseHandler = defaultAIResponseHandler,
    private readonly usageService: IAIUsageService = defaultUsageService,
    private readonly outputSchemaRegistry: OutputSchemaRegistry = defaultOutputSchemaRegistry,
  ) {}

  /**
   * Generates an explicitly requested, schema-constrained response and only
   * returns application data after local Zod validation succeeds.
   */
  public async generateStructuredOutput<T>(request: {
    prompt: string;
    schema: OutputSchemaDefinition<T>;
    context: NormalizedAnalyticalContext;
    tokenBudget?: AIProviderRequest["tokenBudget"];
    correlationId?: string;
  }): Promise<StructuredOutputResult<T>> {
    const correlationId =
      request.correlationId ||
      `ai-structured-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      this.outputSchemaRegistry.assertRegistered(request.schema);
    } catch (error) {
      if (error instanceof OutputSchemaException) {
        throw new AIServiceException(error.code, error.message, {
          statusCode: error.code === "AI_OUTPUT_SCHEMA_NOT_FOUND" ? 400 : 500,
          correlationId,
          details: error.schemaId ? [`schemaId:${error.schemaId}`] : [],
        });
      }
      throw error;
    }

    if (
      !request.prompt.trim() ||
      request.prompt.length > 20000 ||
      !request.context ||
      !Number.isSafeInteger(request.context.userId) ||
      !request.context.roleId.trim()
    ) {
      throw new AIServiceException(
        "COPILOT_INVALID_REQUEST",
        "Invalid structured generation request",
        { statusCode: 400, correlationId },
      );
    }
    let managedPrompt: ManagedPrompt;
    try {
      managedPrompt = this.promptManager.buildPrompt(request.schema.promptKey, {
        userQuery: request.prompt,
        context: request.context,
      });
    } catch (error: unknown) {
      if (error instanceof PromptException) {
        throw new AIServiceException(
          "COPILOT_PROMPT_ERROR",
          "Approved structured prompt could not be constructed",
          { statusCode: 500, correlationId },
        );
      }
      throw error;
    }
    const providerContext = {
      userId: request.context.userId,
      roleId: request.context.roleId,
      locale: request.context.locale || "en",
      allowedEntities: request.context.allowedEntities
        ? [...request.context.allowedEntities]
        : undefined,
    };
    const tokenBudget = request.tokenBudget;
    for (const value of [
      tokenBudget?.maxInputTokens,
      tokenBudget?.maxOutputTokens,
      tokenBudget?.maxConversationTokens,
    ]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new AIServiceException(
          "COPILOT_INVALID_REQUEST",
          "Invalid structured generation token budget",
          { statusCode: 400, correlationId },
        );
      }
    }
    if (
      tokenBudget?.maxOutputTokens !== undefined &&
      tokenBudget.maxOutputTokens > LLMConfigManager.getConfig().maxOutputTokens
    ) {
      throw new AIServiceException(
        "COPILOT_INVALID_REQUEST",
        "Requested output token limit exceeds the configured provider limit",
        { statusCode: 400, correlationId },
      );
    }
    if (
      tokenBudget?.maxInputTokens !== undefined &&
      Math.ceil(managedPrompt.userPrompt.length / 4) >
        tokenBudget.maxInputTokens
    ) {
      throw new AIServiceException(
        "COPILOT_TOKEN_BUDGET_EXCEEDED",
        "Structured prompt exceeds the requested input token limit",
        { statusCode: 422, correlationId },
      );
    }
    if (!this.provider.generateStructuredOutput) {
      throw new AIServiceException(
        "AI_STRUCTURED_OUTPUT_UNSUPPORTED",
        "Configured AI provider does not support native structured output",
        { statusCode: 501, correlationId },
      );
    }

    const configuredAttempts = Number(
      process.env.AI_STRUCTURED_OUTPUT_RECOVERY_ATTEMPTS ?? "1",
    );
    if (
      !Number.isInteger(configuredAttempts) ||
      configuredAttempts < 0 ||
      configuredAttempts > 2
    ) {
      throw new AIServiceException(
        "AI_OUTPUT_SCHEMA_INVALID",
        "Invalid structured output recovery configuration",
        { statusCode: 500, correlationId },
      );
    }

    const startTime = Date.now();
    let recoveryAttempts = 0;
    const prompt = managedPrompt.userPrompt;
    let systemInstruction = managedPrompt.systemInstruction;
    let finalResponse:
      | Awaited<
          ReturnType<NonNullable<IAIProvider["generateStructuredOutput"]>>
        >
      | undefined;
    let lastValidation:
      ReturnType<typeof validateStructuredOutput<T>> | undefined;

    for (let attempt = 0; attempt <= configuredAttempts; attempt++) {
      try {
        finalResponse = await this.provider.generateStructuredOutput({
          prompt,
          systemInstruction,
          context: providerContext,
          tokenBudget: request.tokenBudget,
          structuredOutput: {
            name: request.schema.name,
            description: request.schema.description,
            schema: request.schema.providerSchema,
          },
        });
      } catch (error: unknown) {
        if (
          error instanceof AIProviderException &&
          error.category === "REJECTED"
        ) {
          throw new AIServiceException(
            "AI_STRUCTURED_OUTPUT_UNSUPPORTED",
            "The configured model rejected the structured output schema",
            { statusCode: 501, correlationId },
          );
        }
        throw this.handleProviderFailure(
          error,
          correlationId,
          Date.now() - startTime,
        );
      }

      if (finalResponse.refusal) {
        throw new AIServiceException(
          "AI_OUTPUT_REFUSED",
          "The AI provider refused this structured generation request",
          { statusCode: 422, correlationId },
        );
      }
      if (
        ["MAX_TOKENS", "LENGTH"].includes(
          (finalResponse.finishReason || "").toUpperCase(),
        )
      ) {
        throw new AIServiceException(
          "AI_OUTPUT_INCOMPLETE",
          "The AI provider response was incomplete",
          { statusCode: 422, correlationId },
        );
      }

      lastValidation = validateStructuredOutput(
        finalResponse.content,
        request.schema.schema,
      );
      if (lastValidation.success) break;
      if (attempt >= configuredAttempts) break;

      recoveryAttempts++;
      logger.warn(
        `[AIService] Structured output validation failed [correlationId: ${correlationId}, schemaId: ${request.schema.id}, category: ${lastValidation.code}, attempt: ${recoveryAttempts}/${configuredAttempts}]`,
      );
      const feedback =
        lastValidation.issues
          .map((issue) => `${issue.path}:${issue.code}`)
          .join(", ") || lastValidation.code;
      systemInstruction = `${managedPrompt.systemInstruction}\n\nA previous response failed local validation. Correct the output and return only a new response matching the registered JSON schema. Validation feedback: ${feedback}.`;
    }

    if (!finalResponse || !lastValidation?.success) {
      const failure = lastValidation;
      const code =
        failure && failure.success === false ? failure.code : "AI_OUTPUT_EMPTY";
      const publicCode =
        recoveryAttempts > 0 ? "AI_OUTPUT_RECOVERY_EXHAUSTED" : code;
      const issues =
        failure && failure.success === false
          ? failure.issues.map((issue) => `${issue.path}:${issue.code}`)
          : [];
      logger.warn(
        `[AIService] Structured output rejected [correlationId: ${correlationId}, schemaId: ${request.schema.id}, code: ${publicCode}, issues: ${issues.join(",")}]`,
      );
      throw new AIServiceException(
        publicCode,
        "AI provider output did not satisfy the required response format",
        {
          statusCode: 422,
          correlationId,
          details: [`schemaId:${request.schema.id}`, ...issues],
        },
      );
    }

    const durationMs = Date.now() - startTime;
    const usage = finalResponse.usage;
    if (usage?.inputTokens !== undefined && usage.outputTokens !== undefined) {
      this.usageService
        .trackUsage({
          requestUuid: correlationId,
          provider: finalResponse.providerName,
          model:
            finalResponse.modelName ||
            this.provider.getProviderMetadata().defaultModel,
          purpose: `STRUCTURED_OUTPUT:${request.schema.id}`,
          promptVersion: managedPrompt.metadata.version,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: durationMs,
          retryCount: (usage.retryCount || 0) + recoveryAttempts,
          status: "SUCCESS",
        })
        .catch(() =>
          logger.warn(
            `[AIService] Structured usage tracking failed [correlationId: ${correlationId}]`,
          ),
        );
    }

    logger.info(
      `[AIService] Structured output validated [correlationId: ${correlationId}, schemaId: ${request.schema.id}, provider: ${finalResponse.providerName}, model: ${finalResponse.modelName || "unknown"}, recoveryAttempts: ${recoveryAttempts}, duration: ${durationMs}ms]`,
    );
    return {
      success: true,
      data: lastValidation.data,
      metadata: {
        schemaId: request.schema.id,
        promptVersion: managedPrompt.metadata.version,
        provider: finalResponse.providerName,
        model: finalResponse.modelName,
        requestId: finalResponse.requestId,
        finishReason: finalResponse.finishReason,
        validationStatus: "valid",
        recoveryAttempts,
        usage: usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined,
      },
    };
  }

  /**
   * Generates a candidate typed analytical plan for normalized Copilot context.
   */
  public async generateCandidatePlan(
    request: AIServiceRequest,
  ): Promise<AIServiceResult> {
    const correlationId =
      request.correlationId ||
      `ai-req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
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
        throw new AIServiceException(mappedCode, err.message, {
          statusCode: err.statusCode,
          correlationId,
          details: err.details,
        });
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
      handledResponse = this.responseHandler.handleResponse(rawResponse, {
        correlationId,
        promptMetadata: managedPrompt.metadata,
        purpose: "CANDIDATE_PLAN",
        startTime,
      });
    } catch (err: unknown) {
      if (err instanceof AIResponseException) {
        logger.error(
          `[AIService] AI response handling failed [correlationId: ${correlationId}, code: ${err.code}]: ${err.message}`,
        );
        const mappedCode: AIServiceErrorCode =
          err.code === "COPILOT_UNSAFE_AI_OUTPUT"
            ? "COPILOT_INVALID_RESPONSE"
            : err.code === "COPILOT_MALFORMED_CANDIDATE" ||
                err.code === "COPILOT_RESPONSE_TOO_LARGE"
              ? "COPILOT_INVALID_RESPONSE"
              : "COPILOT_SERVICE_ERROR";

        throw new AIServiceException(mappedCode, err.message, {
          statusCode: err.statusCode,
          correlationId,
          details: err.details,
        });
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

    // 8. Track model usage telemetry asynchronously / fail-safe in copilot.model_usage
    this.usageService
      .trackUsage({
        requestUuid: correlationId,
        provider: handledResponse.usage.providerName,
        model: handledResponse.usage.modelName,
        promptVersion: managedPrompt.metadata?.version,
        purpose: "CANDIDATE_PLAN",
        inputTokens: handledResponse.usage.inputTokens,
        outputTokens: handledResponse.usage.outputTokens,
        latencyMs: handledResponse.usage.latencyMs || durationMs,
        retryCount: handledResponse.usage.retryCount,
        status:
          handledResponse.status === "FALLBACK"
            ? "FALLBACK"
            : handledResponse.isDegraded
              ? "DEGRADED"
              : "SUCCESS",
      })
      .catch((err) => {
        logger.warn(
          `[AIService] Background model usage tracking encountered an issue: ${err.message}`,
        );
      });

    logger.info(
      `[AIService] Candidate plan completed [correlationId: ${correlationId}, provider: ${result.usage.provider}, outcome: ${result.usage.requestOutcome}, duration: ${durationMs}ms]`,
    );

    return result;
  }

  /**
   * Generates a candidate analytical plan while streaming narrative content incrementally.
   */
  public async generateCandidatePlanStream(
    request: AIServiceRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AIServiceResult> {
    const correlationId =
      request.correlationId ||
      `ai-req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    if (signal?.aborted) {
      throw new AIServiceException(
        "COPILOT_MODEL_TIMEOUT",
        "Request aborted by client",
        {
          correlationId,
        },
      );
    }

    // 1. Validate incoming request parameters
    const validatedRequest = this.requestValidator.validate({
      ...request,
      correlationId,
    });

    // 2. Build provider-neutral ManagedPrompt
    const managedPrompt = this.promptManager.buildPrompt(
      validatedRequest.promptKey,
      {
        userQuery: validatedRequest.prompt,
        context: validatedRequest.context,
      },
      validatedRequest.promptVersion,
    );

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
      `[AIService] Starting streaming candidate plan generation [correlationId: ${correlationId}, role: ${request.context.roleId}]`,
    );

    let rawResponse: AIProviderResponse;

    try {
      if (this.provider.generateCandidatePlanStream) {
        rawResponse = await this.provider.generateCandidatePlanStream(
          providerRequest,
          onChunk,
          signal,
        );
      } else {
        rawResponse =
          await this.provider.generateCandidatePlan(providerRequest);
        const text =
          rawResponse.narrative ||
          rawResponse.candidatePlan?.reasoningSummary ||
          "Candidate plan generated.";
        const words = text.split(" ");
        for (let i = 0; i < words.length; i++) {
          if (signal?.aborted) break;
          onChunk((i === 0 ? "" : " ") + words[i]);
        }
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      throw this.handleProviderFailure(error, correlationId, durationMs);
    }

    if (signal?.aborted) {
      throw new AIServiceException(
        "COPILOT_MODEL_TIMEOUT",
        "Request aborted by client",
        {
          correlationId,
        },
      );
    }

    const durationMs = Date.now() - startTime;

    // 5. Process and validate response
    const handledResponse = this.responseHandler.handleResponse(rawResponse, {
      correlationId,
      promptMetadata: managedPrompt.metadata,
      purpose: "CANDIDATE_PLAN",
      startTime,
    });

    const result: AIServiceResult = {
      candidatePlan: handledResponse.candidatePlan,
      narrative: handledResponse.narrative,
      usage: {
        provider: handledResponse.usage.providerName,
        model: handledResponse.usage.modelName,
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

    this.usageService
      .trackUsage({
        requestUuid: correlationId,
        provider: handledResponse.usage.providerName,
        model: handledResponse.usage.modelName,
        promptVersion: managedPrompt.metadata?.version,
        purpose: "CANDIDATE_PLAN",
        inputTokens: handledResponse.usage.inputTokens,
        outputTokens: handledResponse.usage.outputTokens,
        latencyMs: handledResponse.usage.latencyMs || durationMs,
        retryCount: handledResponse.usage.retryCount,
        status:
          handledResponse.status === "FALLBACK"
            ? "FALLBACK"
            : handledResponse.isDegraded
              ? "DEGRADED"
              : "SUCCESS",
      })
      .catch((err) => {
        logger.warn(
          `[AIService] Background model usage tracking encountered an issue: ${err.message}`,
        );
      });

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
        error.category === "TOKEN_BUDGET_EXCEEDED"
          ? 422
          : error.category === "INVALID_RESPONSE"
            ? 422
            : 503;

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
    const errMessage =
      error instanceof Error ? error.message : "Internal AI service failure";
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
  private mapCategoryToErrorCode(
    category: AIErrorCategory,
  ): AIServiceErrorCode {
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
