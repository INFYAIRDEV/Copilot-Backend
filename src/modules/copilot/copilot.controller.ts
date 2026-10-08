import { Request, Response } from "express";
import { ApiResponse } from "@/shared/types/response.js";
import { CopilotError, copilotService } from "./copilot.service.js";
import {
  createConversationSchema,
  historySchema,
  sendMessageSchema,
} from "./conversation.validation.js";

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

export const copilotController = {
  async create(req: Request, res: Response) {
    const parsed = createConversationSchema.safeParse({ body: req.body ?? {} });
    if (!parsed.success)
      return ApiResponse.error(res, {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
      });
    try {
      const data = await copilotService.createConversation(
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
    const parsed = sendMessageSchema.safeParse({
      params: req.params,
      headers: { "idempotency-key": req.get("Idempotency-Key") },
      body: req.body,
    });
    if (!parsed.success)
      return ApiResponse.error(res, {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid request",
      });
    try {
      const { id } = parsed.data.params;
      const data = await copilotService.sendMessage(
        req.user!.user_id,
        id,
        parsed.data.headers["idempotency-key"],
        parsed.data.body,
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

  async history(req: Request, res: Response) {
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
      const data = await copilotService.history(
        req.user!.user_id,
        id,
        limit,
        cursor,
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
