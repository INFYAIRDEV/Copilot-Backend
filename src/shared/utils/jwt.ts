import { NextFunction, Request, Response } from "express";
import { ApiResponse } from "../types/response.js";
import { prisma } from "./prismaClient.js";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { UnauthorizedError } from "../errors/error.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// JWT access token (create and verify)
// ---------------------------------------------------------------------------

// Fixed signing algorithm. The same one is enforced when a token is verified.
const JWT_ALGORITHM = "HS256";

// Who creates the token and who it is for. Verification rejects any other value.
const JWT_ISSUER = "infysuite-copilot";
const JWT_AUDIENCE = "copilot-api";

// A short secret is easy to guess, so we require at least 32 characters.
const MIN_SECRET_LENGTH = 32;

// Longest token lifetime we allow (7 days).
const MAX_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

// How many seconds one unit of JWT_EXPIRES_IN is worth (s, m, h, d).
const SECONDS_PER_UNIT: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

// Who a verified token belongs to. COP-13 puts this on the request.
export interface AuthenticatedUser {
  id: number;
}

// What we get back after a token is verified.
export interface VerifiedAccessToken {
  user: AuthenticatedUser;
  tokenId: string; // the token's unique id (jti); never log it
  expiresAt: Date;
}

// Turns "15m", "1h", "7d" or "3600" (seconds) into seconds.
// Returns undefined when the text is invalid, zero, or longer than 7 days.
const parseExpiresInSeconds = (raw: string): number | undefined => {
  const match = /^(\d+)([smhd])?$/.exec(raw.trim());
  if (!match) return undefined;
  const seconds = Number(match[1]) * SECONDS_PER_UNIT[match[2] ?? "s"];
  return seconds > 0 && seconds <= MAX_EXPIRES_IN_SECONDS ? seconds : undefined;
};

// Call at startup so the app stops with a clear message when the JWT settings are wrong.
// The messages never contain the secret itself.
export const assertJwtConfig = (): void => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  if (parseExpiresInSeconds(process.env.JWT_EXPIRES_IN ?? "") === undefined) {
    throw new Error(
      "JWT_EXPIRES_IN must be a duration like 15m, 1h or 7d (maximum 7d)",
    );
  }
};

// Creates a signed access token for a user.
// The token holds only: sub (user id), jti (unique id), iat, exp, iss, aud.
export const generateAccessToken = (userId: number) => {
  // Refuse anything that is not a positive whole number.
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("user.invalidUserId");
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("user.accessTokenSecretNotSet");
  }

  const expiresIn = parseExpiresInSeconds(process.env.JWT_EXPIRES_IN ?? "");
  if (expiresIn === undefined) {
    throw new Error("user.accessTokenExpiryNotSet");
  }

  return jwt.sign({}, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: String(userId),
    jwtid: randomUUID(),
  });
};

// Checks a token and returns who it belongs to.
// Every failure throws the same generic 401, so the client learns nothing about why.
export const verifyJwtToken = (token: string): VerifiedAccessToken => {
  // A missing secret is a server problem (not a 401), so it is checked outside the try.
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("user.accessTokenSecretNotSet");
  }

  try {
    // Checks signature, expiry, issuer and audience, and only accepts our algorithm.
    const decoded = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // We only accept tokens with a JSON body.
    if (typeof decoded === "string")
      throw new Error("token body is not an object");

    // The required claims must all be there and well formed.
    const { sub, jti, iat, exp } = decoded;

    if (typeof sub !== "string" || !/^[1-9]\d*$/.test(sub))
      throw new Error("invalid sub claim");
    if (typeof jti !== "string" || jti.length === 0)
      throw new Error("missing jti claim");
    if (typeof iat !== "number") throw new Error("missing iat claim");
    if (typeof exp !== "number") throw new Error("missing exp claim");

    return {
      user: { id: Number(sub) },
      tokenId: jti,
      expiresAt: new Date(exp * 1000),
    };
  } catch (error) {
    // Log only the kind of failure; never the token or the secret.
    logger.warn("JWT verification failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new UnauthorizedError("user.unauthorized");
  }
};

export const verifyAccessToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return ApiResponse.error(res, {
      statusCode: 401,
      messageKey: "user.accessTokenMissing",
    });
  }

  const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET;

  if (!secret) {
    return ApiResponse.error(res, {
      statusCode: 500,
      messageKey: "user.serverConfigurationError",
    });
  }

  interface JwtPayload {
    user_id: number;
    role_id: number;
    session_id?: string;
    iat?: number;
    exp?: number;
  }

  let decodedToken: JwtPayload;
  try {
    decodedToken = jwt.verify(token, secret) as JwtPayload;
  } catch (err: any) {
    return ApiResponse.error(res, {
      statusCode: 401,
      messageKey:
        err.name === "TokenExpiredError"
          ? "user.tokenExpired"
          : "user.invalidToken",
    });
  }

  try {
    // The current Prisma schema has no session model; validate the signed
    // subject against the active user record instead of querying a phantom table.
    const user = await prisma.users.findFirst({
      where: { user_id: decodedToken.user_id, is_active: true },
    });
    if (!user)
      return ApiResponse.error(res, {
        statusCode: 401,
        messageKey: "user.notFound",
      });
    req.user = user;
    return next();
  } catch {
    return ApiResponse.error(res, {
      statusCode: 500,
      messageKey: "common.serverIssue",
    });
  }
};

export const roleBasedAuth = (allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return ApiResponse.error(res, {
          statusCode: 401,
          messageKey: "user.notFound",
        });
      }
      if (!allowedRoles.includes(req.user.role_id)) {
        return ApiResponse.error(res, {
          statusCode: 401,
          messageKey: "user.forbiddenInsufficientRights",
        });
      }
      next();
    } catch (error: any) {
      console.error("Error in AuthMiddleware:", error);
      return ApiResponse.error(res, {
        statusCode: 401,
        message: "Unauthorized: " + error.message,
      });
    }
  };
};

export const restrictOperatorAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = req.user;

  try {
    if (!user) {
      return ApiResponse.error(res, {
        statusCode: 401,
        messageKey: "common.notFound",
        messageParams: { entity: "entity.user" },
      });
    }

    if (user.role_id === "3") {
      return ApiResponse.error(res, {
        messageKey: "common.deniedAccess",
        success: false,
        statusCode: 403,
      });
    }
    next();
  } catch (error: any) {
    console.log("error in restrict operator access middleware", error.message);
    return ApiResponse.error(res, {
      messageKey: "common.errorInRestrictOperator",
      statusCode: 500,
      success: false,
    });
  }
};

export const verifyWebSocketToken = async (
  token: string,
): Promise<{ user_id: number; role_id: string }> => {
  if (!token) {
    throw new Error("user.noTokenProvided");
  }

  const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new Error("user.serverConfigurationError");
  }

  try {
    const decodedToken = jwt.verify(token, secret) as {
      user_id: number;
      role_id: string;
    };

    const user = await prisma.users.findUnique({
      where: { user_id: decodedToken.user_id },
      select: { user_id: true, role_id: true, is_active: true },
    });

    if (!user) {
      throw new Error("user.notFound");
    }

    if (!user.is_active) {
      throw new Error("user.userAccountInactive");
    }

    return { user_id: user.user_id, role_id: user.role_id };
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      throw new Error("user.tokenExpired");
    }
    if (err.name === "JsonWebTokenError") {
      throw new Error("user.invalidToken");
    }
    throw new Error("user.authenticationFailed");
  }
};
