// src/middlewares/error.middleware.ts
import { Request, Response, NextFunction } from "express";
import { ApiResponse } from "../types/response.js";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error(err.stack);

  if (err.name === "ValidationError") {
    return ApiResponse.badRequest(res, "Validation Error", err.errors);
  }

  if (err.statusCode) {
    return ApiResponse.error(res, {
      message: err.message,
      error: err,
      statusCode: err.statusCode,

      success: false,
    });
  }

  // Default to 500 server error
  return ApiResponse.error(res, {
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err : undefined,
    statusCode: 500,
    success: false,
  });
};

// Async handler wrapper
export const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
