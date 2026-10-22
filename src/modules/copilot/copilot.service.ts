import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { t } from "i18next";
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

import {
  contextService,
  ContextService,
  resolveCanonicalTerm,
} from "./context.service.js";
export {
  contextService,
  ContextService,
  resolveCanonicalTerm,
} from "./context.service.js";
export * from "./context.types.js";
import {
  CandidateContextUpdate,
  NormalizedAnalyticalContext,
} from "./context.types.js";

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
  contextSvc: ContextService = new ContextService(repo),
) {
  return {
    async createConversation(userId: number, locale?: string) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new CopilotError(
          401,
          "UNAUTHENTICATED",
          "copilot.errors.UNAUTHENTICATED",
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
          "copilot.errors.UNAUTHENTICATED",
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
          "copilot.validation.idempotencyKeyRequired",
        );
      }

      const roleStr = body.role || message_role.USER;
      if (roleStr !== message_role.USER && roleStr !== message_role.ASSISTANT) {
        throw new CopilotError(
          400,
          "VALIDATION_ERROR",
          "copilot.validation.invalidRole",
        );
      }
      const role = roleStr as message_role;

      if (!Object.values(message_kind).includes(body.kind as message_kind)) {
        throw new CopilotError(
          400,
          "VALIDATION_ERROR",
          "copilot.validation.invalidKind",
        );
      }
      const kind = body.kind as message_kind;

      const conversation = await repo.findOwned(conversationUuid, userId);
      if (!conversation) {
        throw new CopilotError(
          403,
          "COPILOT_PERMISSION_DENIED",
          "copilot.errors.COPILOT_PERMISSION_DENIED",
        );
      }
      if (
        conversation.state !== conversation_state.ACTIVE ||
        conversation.deleted_at !== null
      ) {
        throw new CopilotError(
          409,
          "CONVERSATION_NOT_ACTIVE",
          "copilot.errors.CONVERSATION_NOT_ACTIVE",
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
            "copilot.errors.IDEMPOTENCY_KEY_REUSED",
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
              "copilot.errors.IDEMPOTENCY_KEY_REUSED",
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
          "copilot.errors.COPILOT_PERMISSION_DENIED",
        );
      }
      if (
        conversation.state !== conversation_state.ACTIVE ||
        conversation.deleted_at !== null
      ) {
        throw new CopilotError(
          409,
          "CONVERSATION_NOT_ACTIVE",
          "copilot.errors.CONVERSATION_NOT_ACTIVE",
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
          "copilot.errors.UNAUTHENTICATED",
        );

      const conversation = await repo.findOwned(conversationUuid, userId);
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
          "copilot.errors.UNAUTHENTICATED",
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
          "copilot.errors.UNAUTHENTICATED",
        );

      const conversation = await repo.findOwned(conversationUuid, userId);
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
     * Retrieves the current normalized analytical context for a conversation.
     */
    async getAnalyticalContext(userId: number, conversationUuid: string) {
      return contextSvc.retrieveContext(conversationUuid, userId);
    },

    /**
     * Validates and persists an analytical context update using optimistic concurrency.
     */
    async updateAnalyticalContext(
      userId: number,
      conversationUuid: string,
      expectedVersion: number,
      candidateUpdate: CandidateContextUpdate,
      userContext?: {
        roleId?: string;
        requestUuid?: string;
        scopeHash?: string;
        locale?: "en" | "it";
      },
    ) {
      const current = await contextSvc.retrieveContext(
        conversationUuid,
        userId,
      );
      const merged = contextSvc.mergeContext(current.context, candidateUpdate);
      const validation = contextSvc.validateContext(
        merged,
        {
          userId,
          roleId: userContext?.roleId || "user",
        },
        userContext?.locale,
      );
      if (!validation.isValid) {
        throw new CopilotError(
          400,
          "INVALID_ANALYTICAL_CONTEXT",
          validation.errors?.join("; ") ||
            "copilot.errors.INVALID_ANALYTICAL_CONTEXT",
        );
      }
      return contextSvc.persistContext(
        current.conversationId,
        expectedVersion,
        merged,
        {
          requestUuid: userContext?.requestUuid,
          scopeHash: userContext?.scopeHash,
        },
      );
    },

    /**
     * Orchestrates the standard Copilot interaction flow:
     * User Request -> Conversation Authorization -> User Message Persistence
     * -> Retrieve Current Normalized Context
     * -> AI Processing / Candidate Plan
     * -> Response Validation / Clarification Handling
     * -> Persist Updated Normalized Context (Optimistic Concurrency)
     * -> Assistant Message Persistence
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
      aiProcessor?: (
        userMsg: ReturnType<typeof publicMessage>,
        currentContext: NormalizedAnalyticalContext,
      ) => Promise<{
        kind?: message_kind;
        text: string;
        candidateContextUpdate?: CandidateContextUpdate;
      }>;
      candidateContextUpdate?: CandidateContextUpdate;
      roleId?: string;
    }) {
      const userMessage = await this.sendMessage(
        args.userId,
        args.conversationUuid,
        args.idempotencyKey,
        args.message,
      );

      const currentContextData = await contextSvc.retrieveContext(
        args.conversationUuid,
        args.userId,
      );

      let assistantMessage = null;
      let candidateUpdate = args.candidateContextUpdate;
      let isClarification = false;

      if (args.aiProcessor) {
        const aiResponse = await args.aiProcessor(
          userMessage,
          currentContextData.context,
        );
        if (aiResponse.candidateContextUpdate) {
          candidateUpdate = aiResponse.candidateContextUpdate;
        }
        if (aiResponse.kind === message_kind.CLARIFICATION_REQUEST) {
          isClarification = true;
        }
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

      let analyticalContext = currentContextData.context;

      const isClarificationTurn =
        !candidateUpdate &&
        (isClarification ||
          assistantMessage?.kind === message_kind.CLARIFICATION_REQUEST ||
          args.message.kind === message_kind.CLARIFICATION_REPLY);

      if (isClarificationTurn) {
        // AI-010: Clarification handling keeps existing context untouched until ambiguity resolved
        analyticalContext = contextSvc.handleClarification(
          currentContextData.context,
          message_kind.CLARIFICATION_REQUEST,
        );
      } else if (candidateUpdate) {
        // Merge & Validate candidate plan
        const merged = contextSvc.mergeContext(
          currentContextData.context,
          candidateUpdate,
        );
        const validation = contextSvc.validateContext(
          merged,
          { userId: args.userId, roleId: args.roleId || "user" },
          userMessage.locale === "it" ? "it" : "en",
        );
        if (!validation.isValid) {
          throw new CopilotError(
            400,
            "INVALID_ANALYTICAL_CONTEXT",
            validation.errors?.join("; ") ||
              "copilot.errors.INVALID_ANALYTICAL_CONTEXT",
          );
        }

        analyticalContext = await contextSvc.persistContext(
          currentContextData.conversationId,
          currentContextData.version,
          merged,
          {
            requestUuid: userMessage.request_uuid,
          },
        );
      }

      return { userMessage, assistantMessage, analyticalContext };
    },
  };
}


// ---------------------------------------------------------------------------
// Sales Intelligence Copilot - Analytical Query Workflow (Version 3.0 Baseline)
// ---------------------------------------------------------------------------

import { generateQueryFromAi, interpretResultFromAi } from "./ai-client.service.js";
import { checkUserQuota, recordUserUsage } from "./quota.service.js";
import { checkUserAuthorization, executeReadOnlyQuery } from "./execution.service.js";
import { prisma } from "../../shared/utils/prismaClient.js";
import { logger } from "../../shared/utils/logger.js";

export interface ProcessCopilotQueryArgs {
  userId: number;
  roleId?: string;
  question: string;

  conversationUuid?: string;
  locale?: string;
}

export interface CopilotQueryResult {
  status: "SUCCESS" | "NEEDS_CLARIFICATION";
  requestId: string;
  conversationId: string;
  aiSessionId?: string | null;
  question: string;
  clarificationQuestion?: string;
  summary?: string;
  answer?: string;
  sql?: string;
  table?: {
    columns: Array<{ name: string; type: string }> | string[];
    rows: any[];
  };
  chart?: {
    type?: "bar" | "line" | "scatter" | "table" | string;
    title?: string;
    x?: string;
    y?: string;
  };
  rowCount?: number;
  truncated?: boolean;
  executionMetadata?: {
    durationMs: number;
  };
}

/**
 * Executes the complete Sales Intelligence Copilot workflow as defined in
 * the MVP Architecture Guide (Section 6, 7, 8, 10):
 *
 * 1. Authenticates user & checks usage allowance (quota gating).
 * 2. Gets or creates the conversation thread in PostgreSQL.
 * 3. Saves the user's question message.
 * 4. Calls Data/AI Query Service (POST /v1/query/generate).
 * 5. Handles NEEDS_CLARIFICATION if ambiguous.
 * 6. Checks backend RBAC and table/column authorization.
 * 7. Executes SQL via read-only PostgreSQL transaction with interactive cap.
 * 8. Sends bounded results to Data/AI Service (POST /v1/result/interpret).
 * 9. Records model token usage in database.
 * 10. Persists assistant message and answer row.
 * 11. Returns unified response to frontend.
 */
export async function processCopilotQuery(
  args: ProcessCopilotQueryArgs,
): Promise<CopilotQueryResult> {
  const { userId, roleId = "user", question, conversationUuid, locale = "en" } = args;

  console.log("inside processCopilotQuery")

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new CopilotError(401, "UNAUTHENTICATED", "copilot.errors.UNAUTHENTICATED");
  }

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    throw new CopilotError(400, "INVALID_REQUEST", "Question is required.");
  }

  if (question.length > 4000) {
    throw new CopilotError(413, "PAYLOAD_TOO_LARGE", "Question exceeds 4,000 character limit.");
  }

  console.log("inside processCopilotQuery")

  const requestId = randomUUID();

  // logger.info("QUERY_REQUEST_RECEIVED", {
  //   severity: "INFO",
  //   event: "QUERY_REQUEST_RECEIVED",
  //   requestId,
  //   userId,
  //   locale,
  // });

  // 1. Quota Check (Section 8.2)
  // await checkUserQuota(userId, roleId);

  // 2. Load or Create Conversation
  let conversation: any = null;
  if (conversationUuid && isValidUuid(conversationUuid)) {
    conversation = await conversationRepository.findOwned(conversationUuid, userId);
  }

  if (!conversation) {
    const created = await conversationRepository.create(userId, locale as locale_code);
    conversation = await conversationRepository.findOwned(created.conversation_uuid, userId);
  }

  // 3. Save User Message
  const userMsg = await conversationRepository.createMessage({
    conversation_id: conversation.id,
    role: message_role.USER,
    kind: message_kind.QUESTION,
    text: question,
    locale: locale as locale_code,
    request_uuid: requestId,
  });

  // 4. Retrieve stored aiSessionId from conversation for session reuse
  const existingAiSessionId: string | null =
    (conversation.analytical_context as any)?.aiSessionId || null;

  // 5. Call Data/AI Query Service (API 1: POST /v1/query/generate)
  console.log("before generateQueryFromAi")
  const aiResult = await generateQueryFromAi({
    requestId,
    conversationId: conversation.conversation_uuid,
    userId: `${userId}`,
    aiSessionId: existingAiSessionId,
    question,
    locale,
  });
  console.log("after generateQueryFromAi")

  // Save returned aiSessionId to conversation so follow-ups reuse the same session
  const returnedSessionId = (aiResult as any).aiSessionId;
  if (returnedSessionId && returnedSessionId !== existingAiSessionId) {
    const currentContext = (conversation.analytical_context as any) || {};
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        analytical_context: {
          ...currentContext,
          aiSessionId: returnedSessionId,
        },
        updated_at: new Date(),
      },
    });
  }

  // 6. Handle NEEDS_CLARIFICATION
  if (aiResult.status === "NEEDS_CLARIFICATION") {
    const clarificationQuestion =
      aiResult.clarificationQuestion ||
      (aiResult as any).question ||
      "What would you like to rank: customers, products, salespeople, or territories?";

    await conversationRepository.createAssistantMessage({
      conversation_id: conversation.id,
      kind: message_kind.CLARIFICATION_REQUEST,
      text: clarificationQuestion,
      locale: locale as locale_code,
      request_uuid: randomUUID(),
    });

    return {
      status: "NEEDS_CLARIFICATION",
      requestId,
      conversationId: conversation.conversation_uuid,
      aiSessionId: returnedSessionId || existingAiSessionId,
      question: clarificationQuestion,
      clarificationQuestion,
    };
  }

  // 7. Backend RBAC / Authorization check (Section 6.3 & 10)
  checkUserAuthorization({ id: userId, role_id: roleId }, aiResult.referencedTables, aiResult.referencedColumns);

  // 8. Execute Read-Only SQL on Cloud SQL PostgreSQL (Section 6.3 & 7)
  const execution = await executeReadOnlyQuery(aiResult.sql);

  // 9. Send Bounded Matrix Result to Data/AI Service for Narration (API 2: POST /v1/result/interpret)
  const interpretation = await interpretResultFromAi({
    requestId: `${requestId}`,
    conversationId: conversation.conversation_uuid,
    userId: `${userId}`,
    aiSessionId: returnedSessionId || existingAiSessionId,
    question,
    result: execution.matrixResult,
    executionMetadata: {
      durationMs: execution.durationMs,
    },
  });

  // 10. Record Model Usage
  await recordUserUsage({
    userId,
    requestId,
    durationMs: execution.durationMs,
  });

  // 11. Format Unified UI Answer & Persist to Database
  const finalAnswer = interpretation.answer || interpretation.summary || "Analysis completed.";
  const finalChart = interpretation.chart || interpretation.visualization;

  const completeAnswer = {
    id: randomUUID(),
    question,
    summary: finalAnswer,
    answer: finalAnswer,
    chart: finalChart,
    table: {
      columns: execution.matrixResult.columns,
      rows: execution.matrixResult.rows,
    },
    sql: aiResult.sql,
    rowCount: execution.rowCount,
    truncated: execution.matrixResult.truncated,
    durationMs: execution.durationMs,
    aiSessionId: returnedSessionId || existingAiSessionId,
  };

  try {
    const assistantMsg = await conversationRepository.createAssistantMessage({
      conversation_id: conversation.id,
      kind: message_kind.QUESTION,
      text: JSON.stringify(completeAnswer),
      locale: locale as locale_code,
      request_uuid: randomUUID(),
    });

    await prisma.answer.create({
      data: {
        answer_uuid: completeAnswer.id,
        conversation_id: conversation.id,
        message_id: assistantMsg.id,
        status: "SUCCESS",
        request_uuid: requestId,
        locale: locale as any,
        query_fingerprint: question,
        structured_result_ref: JSON.stringify({
          summary: finalAnswer,
          visualization: finalChart,
          aiSessionId: returnedSessionId || existingAiSessionId,
        }),
        normalized_plan: {
          sql: aiResult.sql,
          referencedTables: aiResult.referencedTables,
          referencedColumns: aiResult.referencedColumns,
          rowCount: execution.rowCount,
          durationMs: execution.durationMs,
        },
      },
    });
  } catch (dbErr: any) {
    logger.warn(`Failed to record answer row: ${dbErr.message}`);
  }

  logger.info("REQUEST_COMPLETED", {
    severity: "INFO",
    event: "REQUEST_COMPLETED",
    requestId,
    conversationId: conversation.conversation_uuid,
    durationMs: execution.durationMs,
    rowCount: execution.rowCount,
  });

  return {
    status: "SUCCESS",
    requestId,
    conversationId: conversation.conversation_uuid,
    aiSessionId: returnedSessionId || existingAiSessionId,
    question,
    summary: finalAnswer,
    answer: finalAnswer,
    sql: aiResult.sql,
    table: {
      columns: execution.matrixResult.columns,
      rows: execution.matrixResult.rows,
    },
    chart: finalChart,
    rowCount: execution.rowCount,
    truncated: execution.matrixResult.truncated,
    executionMetadata: {
      durationMs: execution.durationMs,
    },
  };
}

export async function generateCandidateAnalyticalPlan(
  userPrompt: string,
  userContext: { userId: number; roleId: string; locale?: string },
) {
  logger.info(`[CopilotService] Processing analytical plan request for user_id [${userContext.userId}]`);

  const result = await generateQueryFromAi({
    requestId: randomUUID(),
    conversationId: `conv-plan-${randomUUID()}`,
    userId: `user-${userContext.userId}`,
    aiSessionId: null,
    question: userPrompt,
    locale: userContext.locale,
  });

  if (result.status === "NEEDS_CLARIFICATION") {
    const clarQuestion = result.clarificationQuestion || (result as any).question || "Clarification required.";
    return {
      response: {
        isDegraded: false,
        candidatePlan: {
          candidateIntents: [],
          clarification: {
            status: "REQUIRED",
            question: clarQuestion,
          },
        },
      },
      validation: { isValid: true },
    };
  }

  return {
    response: {
      isDegraded: false,
      candidatePlan: {
        candidateIntents: [
          {
            intent: "ANALYTICAL_QUERY",
            metrics: result.referencedColumns,
            dimensions: result.referencedTables,
          },
        ],
      },
    },
    validation: {
      isValid: true,
      validatedPlan: {
        sql: result.sql,
        tables: result.referencedTables,
      },
    },
  };
}

export const copilotService = {
  ...createCopilotService(conversationRepository),
  query: processCopilotQuery,
  generateCandidateAnalyticalPlan,
};

export class CopilotService {
  constructor(public aiServiceOrProvider?: any) {}

  async generateCandidateAnalyticalPlan(
    userPrompt: string,
    userContext: { userId: number; roleId: string; locale?: string },
  ) {
    if (this.aiServiceOrProvider?.generateCandidatePlan) {
      const response = await this.aiServiceOrProvider.generateCandidatePlan({
        prompt: userPrompt,
        context: userContext,
      });
      const validation = this.performSemanticAndPolicyValidation(
        response.candidatePlan,
        userContext,
        userContext?.locale || "en",
      );
      return { response, validation };
    }
    return generateCandidateAnalyticalPlan(userPrompt, userContext);
  }

  performSemanticAndPolicyValidation(
    candidatePlan: any,
    userContext: { userId: number; roleId: string },
    locale: string = "en",
  ) {
    const errors: string[] = [];
    for (const intent of candidatePlan?.candidateIntents || []) {
      if (
        userContext.roleId === "operator" &&
        intent.metrics?.includes("executive_cost_margin")
      ) {
        errors.push(t("copilot.analytical.executiveMarginDenied", { lng: locale }));
      }
    }
    return {
      isValid: errors.length === 0,
      validationErrors: errors.length > 0 ? errors : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

export const analyticalCopilotService = copilotService;



