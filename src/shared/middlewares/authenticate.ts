// COP-13: authentication only (who is the caller). Ownership checks live elsewhere.
import { NextFunction, Request, Response } from "express";
import { ApiResponse } from "../types/response.js";
import { APIResponse } from "../errors/error.js";
import { verifyJwtToken, type AuthenticatedUser } from "../utils/jwt.js";
import { logger } from "../utils/logger.js";

// Typed request context. No `any`.
declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

// Every authentication failure gets the same 401, so nothing is revealed.
const reject = (res: Response, reason: string) => {
  logger.warn("Authentication rejected", { reason });
  return ApiResponse.error(res, {
    statusCode: 401,
    messageKey: "user.unauthorized",
  });
};

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const header = req.headers.authorization;
  if (!header) return reject(res, "missing_header");

  // Exactly "Bearer <token>". Any other scheme or shape is refused.
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return reject(res, "bad_scheme_or_format");

  try {
    // Signature, algorithm, expiry, issuer, audience and claims are checked in COP-12 code.
    const { user } = verifyJwtToken(match[1]);
    // Identity comes only from the verified token, never from body, query or params.
    req.authenticatedUser = { id: user.id };
    return next();
  } catch (error) {
    // verifyJwtToken already logged the reason; it throws APIResponse (401) for bad tokens.
    if (error instanceof APIResponse) {
      return ApiResponse.error(res, {
        statusCode: 401,
        messageKey: "user.unauthorized",
      });
    }
    // Anything else (for example a missing JWT_SECRET) is a server problem, not a 401.
    logger.error("Authentication failed unexpectedly", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return ApiResponse.error(res, {
      statusCode: 500,
      messageKey: "common.serverIssue",
    });
  }
};
