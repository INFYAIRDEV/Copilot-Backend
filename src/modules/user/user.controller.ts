// HTTP layer for users: validate, call the service, build the response.
import { Request, Response } from "express";
import { ApiResponse } from "../../shared/types/response.js";
import { APIResponse } from "../../shared/errors/error.js";
import { logger } from "../../shared/utils/logger.js";
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  emailOnlySchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
} from "./user.validation.js";
import { userService } from "./user.services.js";
import { z } from "zod";

const respondError = (
  res: Response,
  error: unknown,
  label: string,
  fallbackKey: string,
) => {
  if (error instanceof APIResponse) {
    return ApiResponse.error(res, {
      messageKey: error.messageKey,
      statusCode: error.statusCode,
    });
  }
  logger.error(label, {
    name: error instanceof Error ? error.name : "unknown",
    code: (error as { code?: string })?.code,
  });
  return ApiResponse.error(res, { messageKey: fallbackKey, statusCode: 500 });
};
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
      const data = await userService.register(parsed.data, req.lang);
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
  async login(req: Request, res: Response) {
    // Plain zod, same as register. Messages are translation keys.
    const parsed = loginSchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }

    try {
      const data = await userService.login(parsed.data);
      return ApiResponse.success(res, {
        messageKey: "user.loggedIn",
        statusCode: 200,
        data,
      });
    } catch (error) {
      // Known errors (401 and 403) become controlled responses.
      if (error instanceof APIResponse) {
        return ApiResponse.error(res, {
          messageKey: error.messageKey,
          statusCode: error.statusCode,
        });
      }
      // Log only the error type and code; never the body, password or token.
      logger.error("User login failed", {
        name: error instanceof Error ? error.name : "unknown",
        code: (error as { code?: string })?.code,
      });
      return ApiResponse.error(res, {
        messageKey: "user.loginFailed",
        statusCode: 500,
      });
    }
  },
  async profile(req: Request, res: Response) {
    // The subject comes only from the verified token. No id is read from the request.
    const authenticated = req.authenticatedUser;
    if (!authenticated) {
      return ApiResponse.error(res, {
        messageKey: "user.unauthorized",
        statusCode: 401,
      });
    }
    try {
      const data = await userService.getProfile(authenticated.id);
      return ApiResponse.success(res, {
        messageKey: "user.profileFetched",
        statusCode: 200,
        data,
      });
    } catch (error) {
      if (error instanceof APIResponse) {
        return ApiResponse.error(res, {
          messageKey: error.messageKey,
          statusCode: error.statusCode,
        });
      }
      logger.error("User profile failed", {
        name: error instanceof Error ? error.name : "unknown",
        code: (error as { code?: string })?.code,
      });
      return ApiResponse.error(res, {
        messageKey: "user.profileFailed",
        statusCode: 500,
      });
    }
  },

  // PATCH /profile — update full name and / or email for the authenticated user.
  // The user ID is NEVER read from the request body; it always comes from the JWT.
  async updateProfile(req: Request, res: Response) {
    const authenticated = req.authenticatedUser;
    if (!authenticated) {
      return ApiResponse.error(res, {
        messageKey: "user.unauthorized",
        statusCode: 401,
      });
    }
    const parsed = updateProfileSchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }
    try {
      const data = await userService.updateProfile(authenticated.id, parsed.data);
      return ApiResponse.success(res, {
        messageKey: "user.profileUpdated",
        statusCode: 200,
        data,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Profile update failed",
        "user.profileUpdateFailed",
      );
    }
  },

  async verifyEmail(req: Request, res: Response) {
    const parsed = verifyEmailSchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }
    try {
      const data = await userService.verifyEmail(parsed.data);
      return ApiResponse.success(res, {
        messageKey: "user.emailVerified",
        statusCode: 200,
        data,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Verify email failed",
        "user.verifyEmailFailed",
      );
    }
  },
  async resendOtp(req: Request, res: Response) {
    const parsed = emailOnlySchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }
    try {
      await userService.resendOtp(parsed.data, req.lang);
      return ApiResponse.success(res, {
        messageKey: "user.otpResent",
        statusCode: 200,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Resend OTP failed",
        "user.resendOtpFailed",
      );
    }
  },
  async forgotPassword(req: Request, res: Response) {
    const parsed = emailOnlySchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }
    try {
      await userService.forgotPassword(parsed.data, req.lang);
      return ApiResponse.success(res, {
        messageKey: "user.forgotPasswordSent",
        statusCode: 200,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Forgot password failed",
        "user.forgotPasswordFailed",
      );
    }
  },
  async resetPassword(req: Request, res: Response) {
    const parsed = resetPasswordSchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }
    try {
      await userService.resetPassword(parsed.data);
      return ApiResponse.success(res, {
        messageKey: "user.passwordReset",
        statusCode: 200,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Reset password failed",
        "user.resetPasswordFailed",
      );
    }
  },
  async changePassword(req: Request, res: Response) {
    const authenticated = req.authenticatedUser;
    if (!authenticated) {
      return ApiResponse.error(res, {
        messageKey: "user.unauthorized",
        statusCode: 401,
      });
    }
    const parsed = changePasswordSchema(z).safeParse(req.body ?? {});
    if (!parsed.success) {
      return ApiResponse.error(res, {
        messageKey: parsed.error.issues[0].message,
        statusCode: 400,
      });
    }
    try {
      await userService.changePassword(authenticated.id, parsed.data);
      return ApiResponse.success(res, {
        messageKey: "user.passwordChanged",
        statusCode: 200,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Change password failed",
        "user.changePasswordFailed",
      );
    }
  },
};
