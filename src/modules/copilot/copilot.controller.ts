import { Request, Response } from "express";
import { ApiResponse } from "../../shared/types/response.js";
import { CopilotError, copilotService } from "./copilot.service.js";
import {
  createConversationSchema,
  historySchema,
  listConversationsSchema,
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
  const header = req.headers["accept-language"]
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

function fail(res: Response, error: unknown, locale: Locale) {
  if (error instanceof CopilotError)
    return ApiResponse.error(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: translateMessage(
        error.message,
        locale,
        "copilot.errors.INTERNAL_ERROR",
      ),
    });
  return ApiResponse.error(res, {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: t("copilot.errors.INTERNAL_ERROR", { lng: locale }),
  });
}

export function createCopilotController(
  service = copilotService,
  streamingSvc = copilotStreamingService,
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
          error: parsed.error.issues,
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
          error: parsed.error.issues,
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
  };
}

export const copilotController = createCopilotController(copilotService);

import { analyticalCopilotService } from "./copilot.service.js";

// Messages below are i18n keys; they are translated when the error is returned.
const analyticalPlanSchema = z.object({
  prompt: z
    .string({ required_error: "copilot.analytical.promptRequired" })
    .min(3, "copilot.analytical.promptMin")
    .max(2000, "copilot.analytical.promptMax"),
});

export class CopilotController {
  constructor(
    private readonly service: CopilotService = analyticalCopilotService,
  ) {}

  /**
   * POST /api/v1/copilot/analytical-plan
   *
   * Generates a Candidate Typed Analytical Plan for the authenticated user.
   * The candidate plan is semantically and policy validated before being returned.
   * It must NOT be used to execute SQL directly — it feeds the Application-Owned AST.
   */
  generateAnalyticalPlan = async (req: Request, res: Response) => {
    const lng = getLocale(req);

    // 1. Validate request body
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

    // 2. Extract authenticated user context — established by verifyAccessToken middleware
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
      locale: req.headers["accept-language"]?.split(",")[0]?.trim() || "en",
    };

    try {
      const { response, validation: semanticValidation } =
        await this.service.generateCandidateAnalyticalPlan(
          validation.data.prompt,
          userContext,
        );

      // 3. Semantic / policy validation failed — return controlled error
      if (!semanticValidation.isValid) {
        logger.warn(
          `[CopilotController] Candidate plan failed semantic validation for user_id [${userContext.userId}]: ${semanticValidation.validationErrors?.join(", ")}`,
        );
        return ApiResponse.error(res, {
          statusCode: 422,
          message: t("copilot.analytical.policyValidationFailed", { lng }),
          error: semanticValidation.validationErrors,
        });
      }

      // 4. Return validated candidate plan + usage telemetry
      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("copilot.analytical.planGenerated", { lng }),
        data: {
          candidatePlan: semanticValidation.validatedPlan,
          fromFallback: response.fromFallback,
          fallbackReason: response.fallbackReason,
          usage: {
            provider: response.usage.providerName,
            model: response.usage.modelName,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            totalTokens: response.usage.totalTokens,
            latencyMs: response.usage.latencyMs,
            retryCount: response.usage.retryCount,
            estimatedCostUsd: response.usage.estimatedCostUsd,
          },
        },
      });
    } catch (error: any) {
      if (error instanceof AIServiceException) {
        logger.error(
          `[CopilotController] AI service error [${error.code}] for user_id [${userContext.userId}]: ${error.message}`,
        );

        return ApiResponse.error(res, {
          statusCode: error.statusCode,
          message: t(`ai.serviceErrors.${error.code}`, {
            lng,
            defaultValue: error.message,
          }),
          code: error.code,
          error: error.details,
        });
      }

      if (error instanceof AIProviderException) {
        // Map provider error categories to HTTP/application error codes
        const statusCode =
          error.category === "TOKEN_BUDGET_EXCEEDED"
            ? 422
            : error.category === "CONFIG_ERROR"
              ? 503
              : error.category === "UNAVAILABLE"
                ? 503
                : 503;

        const clientMessage =
          error.category === "TOKEN_BUDGET_EXCEEDED"
            ? t("ai.serviceErrors.COPILOT_TOKEN_BUDGET_EXCEEDED", { lng })
            : t("ai.serviceErrors.COPILOT_MODEL_UNAVAILABLE", { lng });

        logger.error(
          `[CopilotController] AI provider error [${error.category}] for user_id [${userContext.userId}]: ${error.message}`,
        );

        return ApiResponse.error(res, {
          statusCode,
          message: clientMessage,
          code: `COPILOT_MODEL_${error.category}`,
        });
      }

      logger.error(
        `[CopilotController] Unexpected error for user_id [${userContext.userId}]: ${error?.message}`,
      );

      return ApiResponse.error(res, {
        statusCode: 500,
        message: t("copilot.analytical.unexpectedError", { lng }),
      });
    }
  };
}

export const copilotAnalyticalController = new CopilotController();

Object.assign(copilotController, {
  generateAnalyticalPlan: copilotAnalyticalController.generateAnalyticalPlan,
});
