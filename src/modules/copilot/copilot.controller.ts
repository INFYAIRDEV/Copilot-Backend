import { Request, Response } from "express";
import { z } from "zod";
import { copilotService, CopilotService } from "./copilot.service.js";
import { ApiResponse } from "@/shared/types/response.js";
import { AIProviderException, AIServiceException } from "@/modules/ai/index.js";
import { logger } from "@/shared/utils/logger.js";

const analyticalPlanSchema = z.object({
  prompt: z
    .string({ required_error: "prompt is required" })
    .min(3, "prompt must be at least 3 characters")
    .max(2000, "prompt exceeds maximum allowed length of 2000 characters"),
});

export class CopilotController {
  constructor(private readonly service: CopilotService = copilotService) {}

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
      return ApiResponse.error(res, { statusCode: 401, message: "Unauthorized" });
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
          error.category === "TOKEN_BUDGET_EXCEEDED" ? 422 :
          error.category === "CONFIG_ERROR" ? 503 :
          error.category === "UNAVAILABLE" ? 503 : 503;

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

export const copilotController = new CopilotController();
