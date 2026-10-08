import { NextFunction, Request, Response } from "express";
import { ApiResponse } from "../types/response.js";
import jwt from "jsonwebtoken";
import { prisma } from "./prismaClient.js";

export const generateAccessToken = (user: any, sessionId: string) => {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new Error("user.accessTokenSecretNotSet");
  }
  return jwt.sign(
    { user_id: user.user_id, role_id: user.role_id, session_id: sessionId },
    secret as string,
    {
      expiresIn: "3hr",
    },
  );
};

export const generateRefreshToken = (user: any, sessionId: string) => {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  if (!secret) {
    throw new Error("user.refreshTokenSecretNotSet");
  }
  return jwt.sign(
    { user_id: user.user_id, role_id: user.role_id, session_id: sessionId },
    secret as string,
    {
      expiresIn: "7d",
    },
  );
};

export const generateAccessandRefreshToken = async (
  user: any,
  sessionId: string,
) => {
  const accessToken = generateAccessToken(user, sessionId);
  const refreshToken = generateRefreshToken(user, sessionId);

  // -- Update User refresh token here --

  return { accessToken, refreshToken };
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

  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!secret) {
    return ApiResponse.error(res, {
      statusCode: 500,
      messageKey: "user.serverConfigurationError",
    });
  }

  interface JwtPayload {
    user_id: number;
    role_id: number;
    session_id: string;
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
): Promise<{ user_id: number; role_id: number }> => {
  if (!token) {
    throw new Error("user.noTokenProvided");
  }

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new Error("user.serverConfigurationError");
  }

  try {
    const decodedToken = jwt.verify(token, secret) as {
      user_id: number;
      role_id: number;
    };

    // Verify user exists in database
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

    return decodedToken;
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
