import { Request, Response } from "express";
import { ApiResponse } from "@/shared/types/response.js";
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
import { logger } from "@/shared/utils/logger.js";

function fail(res: Response, error: unknown) {
  if (error instanceof CopilotError)
    return ApiResponse.error(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    });
  return ApiResponse.error(res, {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
}

export function createCopilotController(service = copilotService) {
  return {
    async create(req: Request, res: Response) {
      const parsed = createConversationSchema.safeParse({
        body: req.body ?? {},
      });
      if (!parsed.success)
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
        });
      try {
        const data = await service.createConversation(
          req.user!.user_id,
          parsed.data.body.locale,
        );
        return ApiResponse.success(res, {
          statusCode: 201,
          message: "Conversation created",
          data,
        });
      } catch (error) {
        return fail(res, error);
      }
    },

    async sendMessage(req: Request, res: Response) {
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: "Authentication required",
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
          message: "Invalid request",
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
          message: "Permission denied: copilot.ask required",
        });
      }
      if (Array.isArray(userScopes) && !userScopes.includes("copilot.ask")) {
        return ApiResponse.error(res, {
          statusCode: 403,
          code: "COPILOT_PERMISSION_DENIED",
          message: "Permission denied: copilot.ask required",
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
          message: "Message accepted",
          data,
        });
      } catch (error) {
        return fail(res, error);
      }
    },

    async listConversations(req: Request, res: Response) {
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: "Authentication required",
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
          message: "Permission denied",
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
          message: "Permission denied",
        });
      }

      const parsed = listConversationsSchema.safeParse({
        query: req.query,
      });
      if (!parsed.success)
        return ApiResponse.error(res, {
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: "Invalid query parameters",
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
          message: "Conversations retrieved",
          data,
        });
      } catch (error) {
        return fail(res, error);
      }
    },

    async history(req: Request, res: Response) {
      if (!req.user || !req.user.user_id) {
        return ApiResponse.error(res, {
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: "Authentication required",
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
          message: "Permission denied",
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
          message: "Permission denied",
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
          message: "Invalid history request",
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
          message: "Conversation history",
          data,
        });
      } catch (error) {
        return fail(res, error);
      }
    },
  };
}

export const copilotController = createCopilotController(copilotService);

import { analyticalCopilotService } from "./copilot.service.js";

const analyticalPlanSchema = z.object({
  prompt: z
    .string({ required_error: "prompt is required" })
    .min(3, "prompt must be at least 3 characters")
    .max(2000, "prompt exceeds maximum allowed length of 2000 characters"),
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
    // 1. Validate request body
    const validation = analyticalPlanSchema.safeParse(req.body);
    if (!validation.success) {
      return ApiResponse.error(res, {
        statusCode: 400,
        message: validation.error.issues[0]?.message || "Invalid request",
        error: validation.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }

    // 2. Extract authenticated user context — established by verifyAccessToken middleware
    const authenticatedUser = req.user;
    if (!authenticatedUser) {
      return ApiResponse.error(res, {
        statusCode: 401,
        message: "Unauthorized",
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
          message: "Candidate plan failed policy validation",
          error: semanticValidation.validationErrors,
        });
      }

      // 4. Return validated candidate plan + usage telemetry
      return ApiResponse.success(res, {
        statusCode: 200,
        message: "Candidate analytical plan generated successfully",
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
          message: error.message,
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
            ? "Request exceeds the configured token budget limit"
            : "The AI service is temporarily unavailable. Certified reports remain available.";

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
        message: "An unexpected error occurred while processing your request",
      });
    }
  };
}

export const copilotAnalyticalController = new CopilotController();

Object.assign(copilotController, {
  generateAnalyticalPlan: copilotAnalyticalController.generateAnalyticalPlan,
});
