// HTTP layer for users: validate, call the service, build the response.
import { Request, Response } from "express";
import { ApiResponse } from "../../shared/types/response.js";
import { APIResponse } from "../../shared/errors/error.js";
import { logger } from "../../shared/utils/logger.js";
import { registerSchema } from "./user.validation.js";
import { userService } from "./user.services.js";
import { z } from "zod";

export const userController = {
  async register(req: Request, res: Response) {
    // The messages are translation keys, which ApiResponse translates.
    const parsed = registerSchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }

    try {
      const data = await userService.register(parsed.data);
      return ApiResponse.success(res, {
        messageKey: "user.registered",
        statusCode: 201,
        data,
      });
    } catch (error) {
      // Known errors (for example the 409 conflict) become controlled responses.
      if (error instanceof APIResponse) {
        return ApiResponse.error(res, {
          messageKey: error.messageKey,
          statusCode: error.statusCode,
        });
      }
      // Log only the error type and code; never the request body or the message.
      logger.error("User registration failed", {
        name: error instanceof Error ? error.name : "unknown",
        code: (error as { code?: string })?.code,
      });
      return ApiResponse.error(res, {
        messageKey: "user.registrationFailed",
        statusCode: 500,
      });
    }
  },
};
