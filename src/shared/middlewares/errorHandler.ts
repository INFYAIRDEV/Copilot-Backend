import { Request, Response, NextFunction } from "express";
import { ApiResponse } from "../types/response.js";
import { APIResponse } from "../errors/error.js";
import { logger } from "../utils/logger.js";

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) return next(err);

  const e = err as { name?: string; code?: string; type?: string };
  // Log the type only. Never the message, stack or body.
  logger.error("Unhandled request error", { name: e?.name, code: e?.code });

  // Known application errors (401, 403, 409, ...).
  if (err instanceof APIResponse) {
    return ApiResponse.error(res, {
      messageKey: err.messageKey,
      messageParams: err.messageParams,
      statusCode: err.statusCode,
    });
  }

  // Malformed JSON from body-parser. Its error object carries the raw body.
  if (e?.type === "entity.parse.failed") {
    return ApiResponse.error(res, {
      messageKey: "user.invalidRequest",
      statusCode: 400,
    });
  }

  return ApiResponse.error(res, {
    messageKey: "common.serverIssue",
    statusCode: 500,
  });
};

export const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
