import { Request, Response } from "express";
import { ApiResponse } from "../../shared/types/response.js";
import { CopilotError, copilotService, processCopilotQuery } from "./copilot.service.js";
import { prisma } from "../../shared/utils/prismaClient.js";

import {
  createConversationSchema,
  deleteConversationSchema,
  historySchema,
  listConversationsSchema,
  renameConversationSchema,
  sendMessageSchema,
} from "./conversation.validation.js";

import { z } from "zod";
import { CopilotService } from "./copilot.service.js";
import { AIProviderException, AIServiceException } from "@/modules/ai/index.js";
import { logger } from "../../shared/utils/logger.js";
import { t } from "i18next";

import {
  CopilotStreamingService,
  copilotStreamingService,
} from "./copilot-streaming.service.js";
import {
  ChatStreamEmitter,
  STREAM_EVENT_TYPES,
  formatSseEvent,
} from "./streaming.types.js";

type Locale = "en" | "it";

/**
 * Resolves the response language: body.locale first, then Accept-Language.
 */
function getLocale(req: Request): Locale {
  const bodyLocale = (req.body as any)?.locale;
  if (bodyLocale === "it" || bodyLocale === "en") return bodyLocale;
  const header = (req.headers || {})["accept-language"]
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return header?.startsWith("it") ? "it" : "en";
}

/**
 * Translates messages that are i18n keys (e.g. "copilot.errors.X");
 * plain messages are returned unchanged.
 */
function translateMessage(
  message: string | undefined,
  locale: Locale,
  fallbackKey: string,
): string {
  if (message && message.startsWith("copilot.")) {
    return t(message, { lng: locale, defaultValue: message });
  }
  return message || t(fallbackKey, { lng: locale });
}

function translateIssues(issues: z.ZodIssue[], locale: Locale) {
  return issues.map((i) => ({
    ...i,
    message: t(i.message, { lng: locale, defaultValue: i.message }),
  }));
}

function fail(res: Response, error: unknown, locale: Locale) {
  if (error instanceof CopilotError) {
    return ApiResponse.error(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: translateMessage(
        error.message,
        locale,
        "copilot.errors.INTERNAL_ERROR",
      ),
    });
  }

  const anyErr = error as any;
  if (anyErr && typeof anyErr === "object" && anyErr.statusCode) {
    return ApiResponse.error(res, {
      statusCode: anyErr.statusCode,
      code: anyErr.code || "COPILOT_ERROR",
      message: anyErr.message || t("copilot.errors.INTERNAL_ERROR", { lng: locale }),
      data: anyErr.status ? { status: anyErr.status, retryable: anyErr.retryable } : undefined,
    });
  }

  return ApiResponse.error(res, {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: t("copilot.errors.INTERNAL_ERROR", { lng: locale }),
  });
}

export function createCopilotController(
  service: any = copilotService,
  streamingSvc: any = copilotStreamingService,
) {
  return {
    async create(req: Request, res: Response) {
      const locale = getLocale(req);
      const parsed = createConversationSchema.safeParse({
        body: req.body ?? {},
      });
      if (!parsed.success)
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.controller.invalidRequestBody", { lng: locale }),
        });
      try {
        const data = await service.createConversation(
          req.user!.user_id,
          parsed.data.body.locale,
        );
        return ApiResponse.success(res, {
          statusCode: 201,
          message: t("copilot.controller.conversationCreated", {
            lng: locale,
          }),
          data,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    async sendMessage(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const rawRequestId = req.get("X-Request-Id") || req.get("X-Request-UUID");
      const parsed = sendMessageSchema.safeParse({
        params: req.params,
        headers: {
          "idempotency-key": req.get("Idempotency-Key"),
          ...(rawRequestId ? { "x-request-id": rawRequestId } : {}),
        },
        body: req.body,
      });
      if (!parsed.success)
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.validation.invalidRequest", { lng: locale }),
          error: translateIssues(parsed.error.issues, locale),
        });

      // Enforce copilot.ask authorization if permissions or scopes are configured on authenticated user
      const userPermissions = (req.user as any).permissions;
      const userScopes = (req.user as any).scopes;
      if (
        Array.isArray(userPermissions) &&
        !userPermissions.includes("copilot.ask")
      ) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.errors.PERMISSION_COPILOT_ASK_REQUIRED", {
            lng: locale,
          }),
        });
      }
      if (Array.isArray(userScopes) && !userScopes.includes("copilot.ask")) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.errors.PERMISSION_COPILOT_ASK_REQUIRED", {
            lng: locale,
          }),
        });
      }

      try {
        const { id } = parsed.data.params;
        const request_uuid = parsed.data.headers["x-request-id"];
        const data = await service.sendMessage(
          req.user.user_id,
          id,
          parsed.data.headers["idempotency-key"],
          {
            ...parsed.data.body,
            ...(request_uuid ? { request_uuid } : {}),
          },
        );
        return ApiResponse.success(res, {
          statusCode: 201,
          message: t("copilot.controller.messageAccepted", { lng: locale }),
          data,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    async streamMessage(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const rawRequestId = req.get("X-Request-Id") || req.get("X-Request-UUID");
      const parsed = sendMessageSchema.safeParse({
        params: req.params,
        headers: {
          "idempotency-key": req.get("Idempotency-Key"),
          ...(rawRequestId ? { "x-request-id": rawRequestId } : {}),
        },
        body: req.body,
      });
      if (!parsed.success) {
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.validation.invalidRequest", { lng: locale }),
          error: translateIssues(parsed.error.issues, locale),
        });
      }

      const userPermissions = (req.user as any).permissions;
      const userScopes = (req.user as any).scopes;
      if (
        Array.isArray(userPermissions) &&
        !userPermissions.includes("copilot.ask")
      ) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.errors.PERMISSION_COPILOT_ASK_REQUIRED", {
            lng: locale,
          }),
        });
      }
      if (Array.isArray(userScopes) && !userScopes.includes("copilot.ask")) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.errors.PERMISSION_COPILOT_ASK_REQUIRED", {
            lng: locale,
          }),
        });
      }

      const { id: conversationUuid } = parsed.data.params;
      const idempotencyKey = parsed.data.headers["idempotency-key"];
      const requestUuid = parsed.data.headers["x-request-id"];

      // Pre-flight conversation check before opening SSE stream
      try {
        await streamingSvc.validateUserAndConversation(
          req.user.user_id,
          conversationUuid,
          userPermissions,
          userScopes,
        );
      } catch (err: any) {
        return fail(res, err, locale);
      }

      // Establish SSE Response Headers (HTTP 200 OK)
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });

      const emitter: ChatStreamEmitter = {
        emitStart: (data) =>
          res.write(formatSseEvent(STREAM_EVENT_TYPES.RESPONSE_STARTED, data)),
        emitChunk: (data) =>
          res.write(formatSseEvent(STREAM_EVENT_TYPES.CONTENT_CHUNK, data)),
        emitResult: (data) =>
          res.write(formatSseEvent(STREAM_EVENT_TYPES.RESULT_AVAILABLE, data)),
        emitDegraded: (data) =>
          res.write(formatSseEvent(STREAM_EVENT_TYPES.DEGRADED_RESPONSE, data)),
        emitComplete: (data) =>
          res.write(
            formatSseEvent(STREAM_EVENT_TYPES.RESPONSE_COMPLETED, data),
          ),
        emitError: (data) =>
          res.write(formatSseEvent(STREAM_EVENT_TYPES.ERROR, data)),
        isAborted: () => aborted,
        abort: () => {
          aborted = true;
        },
      };

      try {
        await streamingSvc.streamChatResponse({
          userId: req.user.user_id,
          userRoleId: (req.user as any).role_id || "user",
          userPermissions,
          userScopes,
          conversationUuid,
          idempotencyKey,
          requestUuid,
          message: parsed.data.body,
          emitter,
        });
      } catch (error: any) {
        if (!aborted) {
          emitter.emitError({
            code: (error as any).code || "COPILOT_SERVICE_ERROR",
            message: translateMessage(
              (error as any).message,
              locale,
              "copilot.controller.streamingFailed",
            ),
            status_code: (error as any).statusCode || 500,
          });
        }
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
      }
    },

    async listConversations(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const userPermissions = (req.user as any).permissions;
      const userScopes = (req.user as any).scopes;
      if (
        Array.isArray(userPermissions) &&
        userPermissions.length > 0 &&
        !userPermissions.includes("copilot.read") &&
        !userPermissions.includes("copilot.ask")
      ) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.controller.permissionDenied", { lng: locale }),
        });
      }
      if (
        Array.isArray(userScopes) &&
        userScopes.length > 0 &&
        !userScopes.includes("copilot.read") &&
        !userScopes.includes("copilot.ask")
      ) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.controller.permissionDenied", { lng: locale }),
        });
      }

      const parsed = listConversationsSchema.safeParse({
        query: req.query,
      });
      if (!parsed.success)
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.controller.invalidQueryParameters", {
            lng: locale,
          }),
        });

      try {
        const { limit, cursor } = parsed.data.query;
        const { limit: _l, cursor: _c, ...filters } = (req.query as any) || {};
        const data = await service.listConversations(
          req.user.user_id,
          limit,
          cursor,
          filters,
        );
        return ApiResponse.success(res, {
          message: t("copilot.controller.conversationsRetrieved", {
            lng: locale,
          }),
          data,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    async history(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const userPermissions = (req.user as any).permissions;
      const userScopes = (req.user as any).scopes;
      if (
        Array.isArray(userPermissions) &&
        userPermissions.length > 0 &&
        !userPermissions.includes("copilot.read") &&
        !userPermissions.includes("copilot.ask")
      ) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.controller.permissionDenied", { lng: locale }),
        });
      }
      if (
        Array.isArray(userScopes) &&
        userScopes.length > 0 &&
        !userScopes.includes("copilot.read") &&
        !userScopes.includes("copilot.ask")
      ) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: t("copilot.controller.permissionDenied", { lng: locale }),
        });
      }

      const parsed = historySchema.safeParse({
        params: req.params,
        query: req.query,
      });
      if (!parsed.success)
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.controller.invalidHistoryRequest", {
            lng: locale,
          }),
        });
      try {
        const { id } = parsed.data.params;
        const { limit, cursor } = parsed.data.query;
        const { limit: _l, cursor: _c, ...filters } = (req.query as any) || {};
        const data = await service.history(
          req.user.user_id,
          id,
          limit,
          cursor,
          filters,
        );
        return ApiResponse.success(res, {
          message: t("copilot.controller.conversationHistory", {
            lng: locale,
          }),
          data,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    async rename(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const parsed = renameConversationSchema.safeParse({
        params: req.params,
        body: req.body,
      });
      if (!parsed.success) {
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.validation.invalidRequest", { lng: locale }),
          error: translateIssues(parsed.error.issues, locale),
        });
      }

      try {
        const { id } = parsed.data.params;
        const { title } = parsed.data.body;
        const data = await service.renameConversation(
          req.user.user_id,
          id,
          title,
        );
        return ApiResponse.success(res, {
          statusCode: 200,
          message: t("copilot.controller.conversationRenamed", { lng: locale }),
          data,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    async delete(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const parsed = deleteConversationSchema.safeParse({
        params: req.params,
      });
      if (!parsed.success) {
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: t("copilot.validation.invalidRequest", { lng: locale }),
          error: translateIssues(parsed.error.issues, locale),
        });
      }

      try {
        const { id } = parsed.data.params;
        const data = await service.deleteConversation(
          req.user.user_id,
          id,
        );
        return ApiResponse.success(res, {
          statusCode: 200,
          message: t("copilot.controller.conversationDeleted", { lng: locale }),
          data,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },
    /**
     * POST /api/v1/copilot/query
     * Primary Sales Intelligence Copilot analytical query endpoint (Section 6 & Figure 1).
     */
    async query(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const question = req.body.question || req.body.prompt || req.body.text;
      if (!question || typeof question !== "string" || question.trim().length === 0) {
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "INVALID_REQUEST",
          message: t("analytics.questionRequired", { lng: locale, defaultValue: "Question is required." }),
        });
      }

      try {
        console.log("inside try ");
        const resolvedUserId = req.user?.user_id ?? (req.body.userId ? Number(req.body.userId) : 3);
        const resolvedRoleId = req.user?.role_id ?? req.body.roleId ?? "user";

        const result = await processCopilotQuery({
          userId: resolvedUserId,
          roleId: resolvedRoleId,
          question: question.trim(),
          conversationUuid:
            req.body.conversationId ||
            req.body.conversationUuid ||
            req.body.conversation_id ||
            req.body.conversation_uuid,
          locale,
        });
        console.log("after processCopilotQuery");
        console.log(result)

        if (result.status === "NEEDS_CLARIFICATION") {
          return ApiResponse.success(res, {
            statusCode: 200,
            message: t("analytics.clarificationRequired", {
              lng: locale,
              defaultValue: "Clarification required.",
            }),
            data: result,
          });
        }

        return ApiResponse.success(res, {
          statusCode: 200,
          message: t("analytics.pipelineExecuted", {
            lng: locale,
            defaultValue: "Query executed successfully.",
          }),
          data: result,
        });
      } catch (error: any) {
        console.error("processCopilotQuery error:", error);
        return fail(res, error, locale);
      }
    },

    /**
     * GET /api/v1/copilot/conversations/:id
     */
    async getConversation(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const { id } = req.params;
      try {
        const conv = await prisma.conversation.findFirst({
          where: {
            conversation_uuid: id,
            owner_user_id: req.user.user_id,
            deleted_at: null,
          },
          include: {
            conversation_message: {
              orderBy: { created_at: "asc" },
            },
          },
        });

        if (!conv) {
          return ApiResponse.error(res, {
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Conversation not found",
          });
        }

        return ApiResponse.success(res, {
          statusCode: 200,
          data: {
            ...conv,
            conversationId: conv.conversation_uuid,
            messages: conv.conversation_message,
          },
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    /**
     * GET /api/v1/copilot/answers
     */
    async listAnswers(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      try {
        const answers = await prisma.answer.findMany({
          where: {
            conversation: {
              owner_user_id: req.user.user_id,
            },
          },
          orderBy: { created_at: "desc" },
          take: 50,
        });

        return ApiResponse.success(res, {
          statusCode: 200,
          data: answers,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },

    /**
     * GET /api/v1/copilot/answers/:id
     */
    async getAnswerById(req: Request, res: Response) {
      const locale = getLocale(req);
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
        });
      }

      const { id } = req.params;
      try {
        const answer = await prisma.answer.findFirst({
          where: {
            answer_uuid: id,
            conversation: {
              owner_user_id: req.user.user_id,
            },
          },
        });

        if (!answer) {
          return ApiResponse.error(res, {
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Answer not found",
          });
        }

        return ApiResponse.success(res, {
          statusCode: 200,
          data: answer,
        });
      } catch (error) {
        return fail(res, error, locale);
      }
    },
  };
}

export const copilotController = createCopilotController(copilotService);

// Messages below are i18n keys; they are translated when the error is returned.
const analyticalPlanSchema = z.object({
  prompt: z
    .string({ required_error: "copilot.analytical.promptRequired" })
    .min(3, "copilot.analytical.promptMin")
    .max(2000, "copilot.analytical.promptMax"),
});

/**
 * Generates a Candidate Typed Analytical Plan for the authenticated user.
 */
export async function generateAnalyticalPlan(req: Request, res: Response) {
  const lng = getLocale(req);

  const validation = analyticalPlanSchema.safeParse(req.body);
  if (!validation.success) {
    return ApiResponse.error(res, {
      statusCode: 400,
      message: validation.error.issues[0]
        ? t(validation.error.issues[0].message, {
          lng,
          defaultValue: validation.error.issues[0].message,
        })
        : t("copilot.validation.invalidRequest", { lng }),
      error: validation.error.issues.map((i) => ({
        field: i.path.join("."),
        message: t(i.message, { lng, defaultValue: i.message }),
      })),
    });
  }

  const authenticatedUser = req.user;
  if (!authenticatedUser) {
    return ApiResponse.error(res, {
      statusCode: 401,
      message: t("copilot.analytical.unauthorized", { lng }),
    });
  }

  const userContext = {
    userId: authenticatedUser.user_id,
    roleId: authenticatedUser.role_id,
    locale: getLocale(req),
  };

  try {
    const { response, validation: semanticValidation } =
      await copilotService.generateCandidateAnalyticalPlan(
        validation.data.prompt,
        userContext,
      );

    if (!semanticValidation.isValid) {
      return ApiResponse.error(res, {
        statusCode: 422,
        message: t("copilot.analytical.policyValidationFailed", { lng }),
      });
    }

    return ApiResponse.success(res, {
      statusCode: 200,
      message: t("copilot.analytical.planGenerated", { lng }),
      data: {
        candidatePlan: semanticValidation.validatedPlan,
      },
    });
  } catch (error: any) {
    return ApiResponse.error(res, {
      statusCode: 500,
      message: t("copilot.analytical.unexpectedError", { lng }),
    });
  }
}

export const copilotAnalyticalController = {
  generateAnalyticalPlan,
};

Object.assign(copilotController, {
  generateAnalyticalPlan,
  queryPipeline: copilotController.query,
  getHistory: copilotController.listConversations,
  getSupportingRecords: copilotController.getAnswerById,
});

