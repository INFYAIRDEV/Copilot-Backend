import { randomUUID } from "node:crypto";
import {
  conversation_state,
  message_kind,
  message_role,
  locale_code,
} from "@prisma/client";
import { conversationRepository } from "./conversation.repository.js";
import { copilotService } from "./copilot.service.js";
import { contextService, ContextService } from "./context.service.js";
import { CopilotError } from "./copilot.error.js";
import {
  ChatStreamEmitter,
  STREAM_EVENT_TYPES,
  sanitizeStreamChunk,
} from "./streaming.types.js";
import {
  IAIService,
  AIService,
  AIServiceRequest,
  AIServiceResult,
  ModelCandidatePlan,
  ResilientAIProvider,
  LLMProviderAdapter,
  AIServiceException,
  AIProviderException,
} from "@/modules/ai/index.js";
import {
  defaultUsageService,
  IAIUsageService,
} from "@/modules/ai/usage/index.js";
import { CandidateContextUpdate } from "./context.types.js";
import { logger } from "../../shared/utils/logger.js";
import { t } from "i18next";

export interface StreamChatRequest {
  userId: number;
  userRoleId?: string;
  userPermissions?: string[];
  userScopes?: string[];
  conversationUuid: string;
  idempotencyKey: string;
  requestUuid?: string;
  message: {
    role?: string;
    kind: message_kind;
    text: string;
    locale?: string;
  };
  emitter: ChatStreamEmitter;
}

import { createCopilotService } from "./copilot.service.js";

export class CopilotStreamingService {
  private readonly copilot: ReturnType<typeof createCopilotService>;
  private readonly context: ContextService;

  constructor(
    private readonly repo = conversationRepository,
    copilot?: ReturnType<typeof createCopilotService>,
    context?: ContextService,
    private readonly aiService: IAIService = new AIService(
      new ResilientAIProvider(new LLMProviderAdapter()),
    ),
    private readonly usageService: IAIUsageService = defaultUsageService,
  ) {
    this.context = context || new ContextService(this.repo);
    this.copilot =
      copilot || createCopilotService(this.repo, undefined, this.context);
  }

  /**
   * Validates user authentication, permissions, and conversation ownership/state
   * prior to opening the streaming channel.
   */
  public async validateUserAndConversation(
    userId: number,
    conversationUuid: string,
    permissions?: string[],
    scopes?: string[],
  ) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new CopilotError(
        401,
        "UNAUTHENTICATED",
        "copilot.errors.UNAUTHENTICATED",
      );
    }

    if (Array.isArray(permissions) && !permissions.includes("copilot.ask")) {
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "copilot.errors.PERMISSION_COPILOT_ASK_REQUIRED",
      );
    }

    if (Array.isArray(scopes) && !scopes.includes("copilot.ask")) {
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "copilot.errors.PERMISSION_COPILOT_ASK_REQUIRED",
      );
    }

    const conversation = await this.repo.findOwned(conversationUuid, userId);
    if (!conversation) {
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "copilot.errors.COPILOT_PERMISSION_DENIED",
      );
    }

    if (
      conversation.state === conversation_state.DELETED ||
      conversation.deleted_at !== null
    ) {
      throw new CopilotError(
        403,
        "COPILOT_PERMISSION_DENIED",
        "copilot.errors.COPILOT_PERMISSION_DENIED",
      );
    }

    if (conversation.state !== conversation_state.ACTIVE) {
      throw new CopilotError(
        409,
        "CONVERSATION_NOT_ACTIVE",
        "copilot.errors.CONVERSATION_NOT_ACTIVE",
      );
    }

    return conversation;
  }

  /**
   * Orchestrates incremental delivery of an AI response via Server-Sent Events (SSE).
   */
  public async streamChatResponse(params: StreamChatRequest): Promise<void> {
    const { emitter, userId, conversationUuid, idempotencyKey, message } =
      params;

    // 1. Pre-flight Validation
    const conversation = await this.validateUserAndConversation(
      userId,
      conversationUuid,
      params.userPermissions,
      params.userScopes,
    );

    // 2. Persist User Message (enforces idempotency, input minimization, redaction)
    const userMessage = await this.copilot.sendMessage(
      userId,
      conversationUuid,
      idempotencyKey,
      message,
    );

    const locale: "en" | "it" = userMessage.locale === "it" ? "it" : "en";

    if (emitter.isAborted()) {
      return;
    }

    const requestUuid =
      userMessage.request_uuid || params.requestUuid || randomUUID();

    // 3. Emit response_started
    emitter.emitStart({
      conversation_uuid: conversationUuid,
      request_uuid: requestUuid,
      created_at: new Date().toISOString(),
    });

    // 4. Retrieve Normalized Analytical Context
    const currentContextData = await this.context.retrieveContext(
      conversationUuid,
      userId,
    );

    let chunkIndex = 0;
    let streamedNarrative = "";

    const onChunk = (delta: string) => {
      if (emitter.isAborted()) return;
      // Sanitize chunk against sensitive patterns (Requirement 11)
      const sanitizedDelta = sanitizeStreamChunk(delta);
      if (sanitizedDelta.length > 0) {
        streamedNarrative += sanitizedDelta;
        emitter.emitChunk({
          delta: sanitizedDelta,
          index: chunkIndex++,
        });
      }
    };

    const abortController = new AbortController();

    // 5. Invoke AI Service
    let aiResult: AIServiceResult;
    try {
      const aiRequest: AIServiceRequest = {
        prompt: userMessage.text || message.text,
        context: {
          userId,
          roleId: params.userRoleId || "user",
          locale: (userMessage.locale as string) || "en",
          conversationId: String(currentContextData.conversationId),
        },
        correlationId: requestUuid,
      };

      if (this.aiService.generateCandidatePlanStream) {
        aiResult = await this.aiService.generateCandidatePlanStream(
          aiRequest,
          onChunk,
          abortController.signal,
        );
      } else {
        aiResult = await this.aiService.generateCandidatePlan(aiRequest);
        const narrative =
          aiResult.narrative ||
          aiResult.candidatePlan?.reasoningSummary ||
          t("copilot.streaming.queryProcessed", { lng: locale });
        const words = narrative.split(" ");
        for (let i = 0; i < words.length; i++) {
          if (emitter.isAborted()) break;
          const chunk = (i === 0 ? "" : " ") + words[i];
          onChunk(chunk);
        }
      }
    } catch (error: any) {
      if (emitter.isAborted()) {
        logger.info(
          `[CopilotStreamingService] Stream aborted by client for request ${requestUuid}`,
        );
        return;
      }

      logger.error(
        `[CopilotStreamingService] AI processing failed: ${error.message}`,
      );

      const errorCode =
        error.code ||
        (error instanceof AIProviderException &&
        error.category === "UNAVAILABLE"
          ? "COPILOT_MODEL_UNAVAILABLE"
          : error instanceof AIProviderException && error.category === "TIMEOUT"
            ? "COPILOT_MODEL_TIMEOUT"
            : "COPILOT_MODEL_UNAVAILABLE");

      emitter.emitError({
        code: errorCode,
        message: t(`ai.serviceErrors.${errorCode}`, {
          lng: locale,
          defaultValue: t("copilot.streaming.aiFailed", { lng: locale }),
        }),
        status_code: error.statusCode || 503,
      });
      return;
    }

    // 6. Client Disconnect Check (Requirement 7)
    if (emitter.isAborted()) {
      logger.info(
        `[CopilotStreamingService] Client disconnected before stream completion: ${requestUuid}`,
      );
      // Incomplete streams must not be saved as successfully delivered answers
      return;
    }

    // 7. Server-owned Candidate Plan Validation (Requirement 4)
    if (aiResult.candidatePlan) {
      const validationResult = this.performSemanticAndPolicyValidation(
        aiResult.candidatePlan,
        { userId, roleId: params.userRoleId || "user" },
        locale,
      );

      if (validationResult.isValid) {
        emitter.emitResult({
          plan_id: aiResult.candidatePlan.planId,
          confidence_score: aiResult.candidatePlan.confidenceScore,
          suggested_visualization:
            aiResult.candidatePlan.suggestedVisualization,
          primary_entity:
            aiResult.candidatePlan.candidateIntents?.[0]?.primaryEntity,
        });
      }
    }

    // 8. Degraded / Fallback Notification (Requirement 9)
    if (aiResult.isDegraded || aiResult.fromFallback) {
      emitter.emitDegraded({
        reason:
          aiResult.fallbackReason ||
          t("copilot.streaming.degradedMode", { lng: locale }),
      });
    }

    // 9. Update Normalized Context (Requirement 6)
    if (
      aiResult.candidatePlan?.candidateIntents &&
      aiResult.candidatePlan.candidateIntents.length > 0
    ) {
      const intent = aiResult.candidatePlan.candidateIntents[0];
      const candidateUpdate: CandidateContextUpdate = {
        metrics: intent.metrics,
        dimensions: intent.dimensions,
        filters: intent.filters as any,
        intentType: intent.intentType,
      };

      const mergedContext = this.context.mergeContext(
        currentContextData.context,
        candidateUpdate,
      );

      const val = this.context.validateContext(mergedContext, {
        userId,
        roleId: params.userRoleId || "user",
      });

      if (val.isValid) {
        try {
          await this.context.persistContext(
            currentContextData.conversationId,
            currentContextData.version,
            mergedContext,
            { requestUuid },
          );
        } catch (err: any) {
          logger.warn(
            `[CopilotStreamingService] Failed to persist analytical context: ${err.message}`,
          );
        }
      }
    }

    // 10. Persist Assistant Message
    const finalNarrative =
      streamedNarrative ||
      aiResult.narrative ||
      aiResult.candidatePlan.reasoningSummary ||
      t("copilot.streaming.queryProcessed", { lng: locale });

    const assistantMessage = await this.copilot.storeAssistantMessage(
      userId,
      conversationUuid,
      {
        kind: message_kind.CLARIFICATION_REQUEST,
        text: finalNarrative,
        locale: userMessage.locale,
        request_uuid: requestUuid,
      },
    );

    // 11. Emit response_completed
    emitter.emitComplete({
      message_id: assistantMessage.id,
      role: "ASSISTANT",
      kind: assistantMessage.kind,
      text: assistantMessage.text || finalNarrative,
      conversation_uuid: conversationUuid,
      created_at: new Date().toISOString(),
      usage: {
        input_tokens: aiResult.usage.inputTokens,
        output_tokens: aiResult.usage.outputTokens,
        total_tokens: aiResult.usage.totalTokens,
        latency_ms: aiResult.usage.latencyMs,
      },
    });
  }

  /**
   * Server-owned semantic and policy validation.
   */
  private performSemanticAndPolicyValidation(
    candidatePlan: ModelCandidatePlan,
    userContext: { userId: number; roleId: string },
    locale: "en" | "it" = "en",
  ): { isValid: boolean; errors?: string[] } {
    const errors: string[] = [];

    for (const intent of candidatePlan.candidateIntents || []) {
      if (
        userContext.roleId === "operator" &&
        intent.metrics.includes("executive_cost_margin")
      ) {
        errors.push(
          t("copilot.streaming.unauthorizedMetric", {
            lng: locale,
            role: userContext.roleId,
            metric: "executive_cost_margin",
          }),
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

export const copilotStreamingService = new CopilotStreamingService();
