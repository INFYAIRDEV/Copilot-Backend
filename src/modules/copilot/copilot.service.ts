import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { conversationRepository } from "./conversation.repository.js";
import {
  paginationService,
  PaginationService,
  computeFilterHash,
} from "./pagination.service.js";
export { paginationService, PaginationService } from "./pagination.service.js";

import { CopilotError } from "./copilot.error.js";
export { CopilotError } from "./copilot.error.js";

const cursorSecret = () =>
  process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;

type CursorData = {
  v: 1;
  uid: number;
  cid: number;
  limit: number;
  created_at: string;
  mid: number;
  exp: number;
};

export function encodeCursor(data: CursorData) {
  return paginationService.encodeMessageCursor({
    userId: data.uid,
    conversationId: data.cid,
    limit: data.limit,
    createdAt: new Date(data.created_at),
    messageId: data.mid,
  });
}

export function decodeCursor(
  cursor: string,
  uid: number,
  cid: number,
  limit: number,
  filterHash?: string | null,
): { created_at: Date; id: number } {
  return paginationService.decodeMessageCursor(cursor, {
    userId: uid,
    conversationId: cid,
    limit,
    filterHash,
  });
}

type ConvListCursorData = {
  v: 1;
  t?: "conv_list";
  res?: "conv_list";
  uid: number;
  limit: number;
  created_at: string;
  cid: number;
  exp: number;
};

export function encodeConvListCursor(data: ConvListCursorData) {
  return paginationService.encodeConversationCursor({
    userId: data.uid,
    conversationId: data.cid,
    limit: data.limit,
    createdAt: new Date(data.created_at),
  });
}

export function decodeConvListCursor(
  cursor: string,
  uid: number,
  limit: number,
  filterHash?: string | null,
): { created_at: Date; id: number } {
  return paginationService.decodeConversationCursor(cursor, {
    userId: uid,
    limit,
    filterHash,
  });
}

export const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /api[_-]?key\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /sk-[a-zA-Z0-9]{20,}/gi,
  /secret\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /access[_-]?token\s*[:=]\s*['"]?[^'"\s,;]+['"]?/gi,
  /(postgres|postgresql|mysql|mongodb):\/\/[^\s'"]+/gi,
  /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[\s\S]*?\b(FROM|INTO|SET|TABLE)\b/gi,
  /\{[\s\S]*?"choices"\s*:\s*\[[\s\S]*?\}/gi,
  /\{[\s\S]*?"candidates"\s*:\s*\[[\s\S]*?\}/gi,
  /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/gi,
];

export function sanitizeAndRedactMessageText(text: string): {
  sanitizedText: string;
  isRedacted: boolean;
} {
  let isRedacted = false;
  let sanitizedText = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(sanitizedText)) {
      isRedacted = true;
      sanitizedText = sanitizedText.replace(pattern, "[REDACTED]");
    }
  }
  return { sanitizedText, isRedacted };
}

export function isValidUuid(str?: string | null): boolean {
  if (!str || typeof str !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    str.trim(),
  );
}

export function computeCanonicalBodyHash(body: {
  role?: string;
  kind: string;
  text: string;
  locale: string;
}): string {
  const normalized = {
    kind: body.kind,
    locale: body.locale,
    role: body.role || message_role.USER,
    text: body.text,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function publicMessage(message: {
  id: number;
  role: string;
  kind: string;
  text: string | null;
  text_redacted: boolean;
  locale: string;
  created_at: Date;
  request_uuid?: string | null;
}) {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    text: message.text_redacted ? null : message.text,
    redacted: message.text_redacted,
    locale: message.locale,
    created_at: message.created_at,
    ...(message.request_uuid ? { request_uuid: message.request_uuid } : {}),
  };
}

export interface SendMessageBody {
  role?: string;
  kind: string;
  text: string;
  locale?: string;
  request_uuid?: string;
}

export interface AssistantMessageInput {
  kind?: message_kind | string;
  text: string;
  locale?: string;
  request_uuid?: string;
  text_redacted?: boolean;
}

export function createCopilotService(
  repo = conversationRepository,
  paginator = paginationService,
) {
  return {
    async createConversation(userId: number, locale?: string) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new CopilotError(
          401,
          "UNAUTHENTICATED",
          "Authentication required",
        );
      return repo.create(userId, locale as locale_code | undefined);
    },

    async sendMessage(
      userId: number,
      conversationUuid: string,
      key: string,
      body: SendMessageBody,
    ) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new CopilotError(
          401,
          "UNAUTHENTICATED",
          "Authentication required",
        );

      if (
        !key ||
        typeof key !== "string" ||
        key.trim().length === 0 ||
        key.length > 128
      ) {
        throw new CopilotError(
          400,
          "VALIDATION_ERROR",
          "Valid Idempotency-Key header is required",
        );
      }

      const roleStr = body.role || message_role.USER;
      if (roleStr !== message_role.USER && roleStr !== message_role.ASSISTANT) {
        throw new CopilotError(400, "VALIDATION_ERROR", "Invalid message role");
      }
      const role = roleStr as message_role;

      if (!Object.values(message_kind).includes(body.kind as message_kind)) {
        throw new CopilotError(400, "VALIDATION_ERROR", "Invalid message kind");
      }
      const kind = body.kind as message_kind;

      const conversation = await repo.findOwned(conversationUuid, userId);
      if (!conversation) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "Conversation access denied",
        );
      }
      if (
        conversation.state !== conversation_state.ACTIVE ||
        conversation.deleted_at !== null
      ) {
        throw new CopilotError(
          409,
          "CONVERSATION_NOT_ACTIVE",
          "Conversation is not active",
        );
      }

      const locale = (
        body.locale === "en" || body.locale === "it"
          ? body.locale
          : conversation.locale
      ) as locale_code;

      const { sanitizedText, isRedacted } = sanitizeAndRedactMessageText(
        body.text,
      );
      const hash = computeCanonicalBodyHash({
        role,
        kind,
        text: body.text,
        locale,
      });

      const prior = await repo.findIdempotentMessage(conversation.id, key);
      if (prior) {
        if (prior.canonical_body_hash !== hash) {
          throw new CopilotError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency-Key was used with a different request body",
          );
        }
        return publicMessage(prior);
      }

      const request_uuid =
        body.request_uuid && isValidUuid(body.request_uuid)
          ? body.request_uuid
          : randomUUID();

      try {
        const created = await repo.createMessage({
          conversation_id: conversation.id,
          role,
          kind,
          text: sanitizedText,
          text_redacted: isRedacted,
          locale,
          request_uuid,
          idempotency_key: key,
          canonical_body_hash: hash,
          question_hash: role === message_role.USER ? sha256(body.text) : null,
        });
        return publicMessage(created);
      } catch (error) {
        // Resolve concurrent requests by reading the unique key winner.
        const raced = await repo.findIdempotentMessage(conversation.id, key);
        if (raced) {
          if (raced.canonical_body_hash !== hash) {
            throw new CopilotError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "Idempotency-Key was used with a different request body",
            );
          }
          return publicMessage(raced);
        }
        throw error;
      }
    },

    async storeAssistantMessage(
      userOrTarget:
        | number
        | {
            conversationId?: number;
            conversationUuid?: string;
            userId?: number;
          },
      conversationUuidOrBody: string | AssistantMessageInput,
      maybeBody?: AssistantMessageInput,
    ) {
      let conversation: any = null;
      let body: AssistantMessageInput;

      if (typeof userOrTarget === "number") {
        if (typeof conversationUuidOrBody === "string") {
          // Signature: (userId: number, conversationUuid: string, body: AssistantMessageInput)
          const userId = userOrTarget;
          const conversationUuid = conversationUuidOrBody;
          body = maybeBody!;
          conversation = await repo.findOwned(conversationUuid, userId);
        } else {
          // Signature: (conversationId: number, body: AssistantMessageInput)
          const conversationId = userOrTarget;
          body = conversationUuidOrBody as AssistantMessageInput;
          conversation = await repo.findById(conversationId);
        }
      } else {
        // Signature: (targetObject, body)
        body = (conversationUuidOrBody as AssistantMessageInput) || maybeBody!;
        if (userOrTarget.conversationUuid && userOrTarget.userId) {
          conversation = await repo.findOwned(
            userOrTarget.conversationUuid,
            userOrTarget.userId,
          );
        } else if (userOrTarget.conversationId) {
          conversation = await repo.findById(userOrTarget.conversationId);
          if (
            conversation &&
            userOrTarget.userId &&
            conversation.owner_user_id !== userOrTarget.userId
          ) {
            conversation = null;
          }
        }
      }

      if (!conversation) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "Conversation access denied",
        );
      }
      if (
        conversation.state !== conversation_state.ACTIVE ||
        conversation.deleted_at !== null
      ) {
        throw new CopilotError(
          409,
          "CONVERSATION_NOT_ACTIVE",
          "Conversation is not active",
        );
      }

      const locale = (
        body.locale === "en" || body.locale === "it"
          ? body.locale
          : conversation.locale
      ) as locale_code;

      const kind = (
        body.kind &&
        Object.values(message_kind).includes(body.kind as message_kind)
          ? body.kind
          : message_kind.CLARIFICATION_REQUEST
      ) as message_kind;

      const { sanitizedText, isRedacted } = sanitizeAndRedactMessageText(
        body.text,
      );
      const request_uuid =
        body.request_uuid && isValidUuid(body.request_uuid)
          ? body.request_uuid
          : randomUUID();

      const created = await repo.createAssistantMessage({
        conversation_id: conversation.id,
        kind,
        text: sanitizedText,
        locale,
        request_uuid,
        text_redacted: isRedacted || (body.text_redacted ?? false),
      });
      return publicMessage(created);
    },

    async getConversationMessages(userId: number, conversationUuid: string) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new CopilotError(
          401,
          "UNAUTHENTICATED",
          "Authentication required",
        );

      const conversation = await repo.findOwned(conversationUuid, userId);
      if (!conversation) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "Conversation access denied",
        );
      }
      if (
        conversation.state === conversation_state.DELETED ||
        conversation.deleted_at !== null
      ) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "Conversation access denied",
        );
      }

      const rows = await repo.findMessagesByConversationId(conversation.id);
      return rows.map(publicMessage);
    },

    async listConversations(
      userId: number,
      limit: number,
      cursor?: string,
      filters?: Record<string, any>,
    ) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new CopilotError(
          401,
          "UNAUTHENTICATED",
          "Authentication required",
        );

      const filterHash = computeFilterHash(filters);
      const after = cursor
        ? paginator.decodeConversationCursor(cursor, {
            userId,
            limit,
            filterHash,
          })
        : undefined;
      const rows = await repo.listUserConversations(userId, after, limit);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last
          ? paginator.encodeConversationCursor({
              userId,
              conversationId: last.id,
              limit,
              createdAt: last.created_at,
              filterHash,
            })
          : null;

      await repo.auditConversationListRead({
        owner_user_id: userId,
        request_uuid: randomUUID(),
        scope_hash: sha256(`user:${userId}:conversation_list:read`),
        query_fingerprint: sha256(
          JSON.stringify({ limit, cursor: cursor ? sha256(cursor) : null }),
        ),
        output_hash: sha256(
          JSON.stringify(
            page.map(({ conversation_uuid, state, created_at }) => ({
              conversation_uuid,
              state,
              created_at,
            })),
          ),
        ),
        returned_count: page.length,
      });

      return {
        conversations: page.map((c) => ({
          conversation_uuid: c.conversation_uuid,
          locale: c.locale,
          state: c.state,
          created_at: c.created_at,
          updated_at: c.updated_at,
        })),
        page: { limit, next_cursor: nextCursor, has_more: hasMore },
      };
    },

    async history(
      userId: number,
      conversationUuid: string,
      limit: number,
      cursor?: string,
      filters?: Record<string, any>,
    ) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new CopilotError(
          401,
          "UNAUTHENTICATED",
          "Authentication required",
        );

      const conversation = await repo.findOwned(conversationUuid, userId);
      if (!conversation) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "Conversation access denied",
        );
      }
      if (
        conversation.state === conversation_state.DELETED ||
        conversation.deleted_at !== null
      ) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "Conversation access denied",
        );
      }
      const filterHash = computeFilterHash(filters);
      const after = cursor
        ? paginator.decodeMessageCursor(cursor, {
            userId,
            conversationId: conversation.id,
            limit,
            filterHash,
          })
        : undefined;
      const rows = await repo.historyPage(conversation.id, after, limit);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last
          ? paginator.encodeMessageCursor({
              userId,
              conversationId: conversation.id,
              limit,
              createdAt: last.created_at,
              messageId: last.id,
              filterHash,
            })
          : null;
      await repo.auditHistoryRead({
        conversation_id: conversation.id,
        request_uuid: randomUUID(),
        scope_hash: sha256(`user:${userId}:conversation:read`),
        query_fingerprint: sha256(
          JSON.stringify({ limit, cursor: cursor ? sha256(cursor) : null }),
        ),
        output_hash: sha256(
          JSON.stringify(
            page.map(({ id, role, kind, created_at }) => ({
              id,
              role,
              kind,
              created_at,
            })),
          ),
        ),
        returned_count: page.length,
      });
      return {
        conversation: {
          conversation_uuid: conversation.conversation_uuid,
          locale: conversation.locale,
          state: conversation.state,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
        },
        messages: page.map(publicMessage),
        page: { limit, next_cursor: nextCursor, has_more: hasMore },
      };
    },

    /**
     * Orchestrates the standard Copilot interaction flow:
     * User Request -> Conversation Authorization -> User Message Persistence
     * -> AI Processing -> Response Validation -> Assistant Message Persistence
     */
    async processConversationTurn(args: {
      userId: number;
      conversationUuid: string;
      idempotencyKey: string;
      message: {
        kind: message_kind;
        text: string;
        locale?: string;
        request_uuid?: string;
      };
      aiProcessor?: (userMsg: ReturnType<typeof publicMessage>) => Promise<{
        kind?: message_kind;
        text: string;
      }>;
    }) {
      const userMessage = await this.sendMessage(
        args.userId,
        args.conversationUuid,
        args.idempotencyKey,
        args.message,
      );

      let assistantMessage = null;
      if (args.aiProcessor) {
        const aiResponse = await args.aiProcessor(userMessage);
        assistantMessage = await this.storeAssistantMessage(
          args.userId,
          args.conversationUuid,
          {
            kind: aiResponse.kind || message_kind.CLARIFICATION_REQUEST,
            text: aiResponse.text,
            locale: userMessage.locale,
            request_uuid: userMessage.request_uuid,
          },
        );
      }

      return { userMessage, assistantMessage };
    },
  };
}

export const copilotService = createCopilotService(conversationRepository);

import {
  IAIService,
  AIService,
  AIServiceRequest,
  AIServiceResult,
  IAIProvider,
  ModelCandidatePlan,
  ResilientAIProvider,
  LLMProviderAdapter,
} from "@/modules/ai/index.js";
import { logger } from "@/shared/utils/logger.js";

export interface SemanticValidationResult {
  isValid: boolean;
  validatedPlan?: ModelCandidatePlan;
  validationErrors?: string[];
}

export class CopilotService {
  private readonly aiService: IAIService;

  /**
   * Domain service depends on IAIService (application-level AI service layer).
   * Supports backward compatibility with IAIProvider for flexible dependency injection.
   */
  constructor(aiServiceOrProvider: IAIService | IAIProvider) {
    if ("isAIService" in aiServiceOrProvider) {
      this.aiService = aiServiceOrProvider as IAIService;
    } else {
      this.aiService = new AIService(aiServiceOrProvider as IAIProvider);
    }
  }

  /**
   * Processes user intent through the AI pipeline:
   * 1. Aggregates and minimizes model inputs into normalized analytical context.
   * 2. Invokes AI Service via IAIService interface to coordinate provider operations & structural validation.
   * 3. Passes candidate plan to application-owned Semantic & Policy Validation.
   * 4. Returns validated candidate plan ready for Server-Owned ExecutionEnvelope construction.
   */
  public async generateCandidateAnalyticalPlan(
    userPrompt: string,
    userContext: { userId: number; roleId: string; locale?: string },
  ): Promise<{
    response: AIServiceResult;
    validation: SemanticValidationResult;
  }> {
    logger.info(
      `[CopilotService] Processing analytical plan request for user_id [${userContext.userId}]`,
    );

    // AI-013 & AI-015: Controlled request context construction
    const request: AIServiceRequest = {
      prompt: userPrompt,
      context: {
        userId: userContext.userId,
        roleId: userContext.roleId,
        locale: userContext.locale || "en",
      },
      tokenBudget: {
        maxInputTokens: 2048,
        maxOutputTokens: 1024,
      },
    };

    // Invoke AI Service layer
    const aiResponse: AIServiceResult =
      await this.aiService.generateCandidatePlan(request);

    // AI-002, AI-003 & AI-018: Candidate Plan is treated as untrusted candidate
    // Candidate Plan MUST be validated by application semantic & policy rules before AST/SQL compilation
    const validationResult = this.performSemanticAndPolicyValidation(
      aiResponse.candidatePlan,
      userContext,
    );

    return {
      response: aiResponse,
      validation: validationResult,
    };
  }

  /**
   * Server-owned Semantic & Policy Validation logic.
   * Ensures provider output cannot override RBAC/ABAC decisions or execute arbitrary SQL.
   */
  private performSemanticAndPolicyValidation(
    candidatePlan: ModelCandidatePlan,
    userContext: { userId: number; roleId: string },
  ): SemanticValidationResult {
    const errors: string[] = [];

    // Verify candidate intents exist
    if (
      !candidatePlan.candidateIntents ||
      candidatePlan.candidateIntents.length === 0
    ) {
      errors.push("Candidate plan contains no valid query intents");
    }

    // Role-based metric / entity boundary checks
    for (const intent of candidatePlan.candidateIntents || []) {
      if (
        userContext.roleId === "operator" &&
        intent.metrics.includes("executive_cost_margin")
      ) {
        errors.push(
          `Unauthorized metric access: role '${userContext.roleId}' cannot access 'executive_cost_margin'`,
        );
      }
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      validatedPlan: isValid ? candidatePlan : undefined,
      validationErrors: errors.length > 0 ? errors : undefined,
    };
  }
}

// Factory instance: CopilotService -> AIService -> ResilientAIProvider -> LLMProviderAdapter
export const analyticalCopilotService = new CopilotService(
  new AIService(new ResilientAIProvider(new LLMProviderAdapter())),
);

// Augment copilotService with analytical plan capability
Object.assign(copilotService, {
  generateCandidateAnalyticalPlan: (
    userPrompt: string,
    userContext: { userId: number; roleId: string; locale?: string },
  ) =>
    analyticalCopilotService.generateCandidateAnalyticalPlan(
      userPrompt,
      userContext,
    ),
});
