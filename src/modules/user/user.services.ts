// Business rules for users.
import { Prisma } from "@prisma/client";
import {
  APIResponse,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from "../../shared/errors/error.js";
import { hashPassword, verifyPassword } from "../../shared/utils/password.js";
import type {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  EmailOnlyInput,
  ResetPasswordInput,
  ChangePasswordInput,
  UpdateProfileInput,
} from "./user.validation.js";
import { userRepository } from "./user.repository.js";
import { logger } from "../../shared/utils/logger.js";
import { generateAccessToken, verifyJwtToken } from "../../shared/utils/jwt.js";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_MAX_SENDS_PER_HOUR,
  type OtpPurpose,
} from "../../shared/utils/otp.js";
import { sendMail } from "../../infrastructure/mailer/mailer.js";
import { buildOtpEmail } from "../../infrastructure/mailer/otpEmail.js";

// Creates a code, stores its hash and emails it. Throws if the email cannot be sent.
const issueOtp = async (
  user: { user_id: number; email: string },
  purpose: OtpPurpose,
  lang?: string,
) => {
  const latest = await userRepository.findLatestOtp(user.user_id, purpose);
  if (
    latest &&
    Date.now() - latest.created_at.getTime() <
      OTP_RESEND_COOLDOWN_SECONDS * 1000
  ) {
    throw new TooManyRequestsError("user.otpResendTooSoon");
  }
  const sent = await userRepository.countOtpSince(
    user.user_id,
    purpose,
    new Date(Date.now() - 60 * 60 * 1000),
  );
  if (sent >= OTP_MAX_SENDS_PER_HOUR) {
    throw new TooManyRequestsError("user.otpSendLimit");
  }

  const otp = generateOtp();
  // createOtp returns [cancelledOldCodes, newCode]. Keep the new row so it can be removed if the mail fails.
  const [, created] = await userRepository.createOtp(
    user.user_id,
    purpose,
    hashOtp(user.user_id, purpose, otp),
    new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  );

  try {
    const mail = buildOtpEmail(purpose, otp, lang, OTP_TTL_MINUTES);
    await sendMail(user.email, mail.subject, mail.text, mail.html);
  } catch (error) {
    const e = error as {
      code?: string;
      command?: string;
      responseCode?: number;
      message?: string;
    };
    // Real SMTP reason (contains no secrets). EAUTH = bad login, ETIMEDOUT/ECONNECTION = network.
    logger.error("OTP email failed", {
      purpose,
      name: e instanceof Error ? e.name : "unknown",
      code: e.code,
      command: e.command,
      responseCode: e.responseCode,
      reason: e.message,
    });
    // An unsent code is useless and would count toward the cooldown and hourly cap.
    await userRepository.deleteOtp(created.id).catch(() => undefined);
    throw new APIResponse("user.emailSendFailed", 500);
  }
};

// Same as issueOtp but never throws, so the response cannot reveal if an email exists.
// The real email failure is already logged inside issueOtp.
const sendOtpQuietly = async (
  user: { user_id: number; email: string },
  purpose: OtpPurpose,
  lang?: string,
) => {
  try {
    await issueOtp(user, purpose, lang);
  } catch (error) {
    logger.warn("OTP not sent", {
      purpose,
      reason: error instanceof APIResponse ? error.messageKey : "unexpected",
      name: error instanceof Error ? error.name : "unknown",
      code: (error as { code?: string })?.code,
    });
  }
};

// Checks a typed code. Returns the OTP row id when correct, throws otherwise.
const checkOtp = async (userId: number, purpose: OtpPurpose, otp: string) => {
  const record = await userRepository.findActiveOtp(userId, purpose);
  if (!record) throw new BadRequestError("user.otpInvalid");

  const attempts = await userRepository.incrementOtpAttempts(record.id);
  if (attempts > OTP_MAX_ATTEMPTS) {
    throw new TooManyRequestsError("user.otpTooManyAttempts");
  }
  if (!verifyOtpHash(userId, purpose, otp, record.otp_hash)) {
    throw new BadRequestError("user.otpInvalid");
  }
  return record.id;
};

export const userService = {
  async register(input: RegisterInput, lang?: string) {
    const conflicts = await userRepository.findConflicts(
      input.username,
      input.email,
    );
    // A verified account owns the name and email. Unverified leftovers do not.
    if (conflicts.some((u) => u.is_email_verified)) {
      throw new ConflictError("user.alreadyExists");
    }
    if (conflicts.length > 0) {
      await userRepository.deleteUnverified(conflicts.map((u) => u.user_id));
    }

    const password_hash = await hashPassword(input.password);

    try {
      const user = await userRepository.create({
        username: input.username,
        full_name: input.full_name,
        email: input.email,
        password_hash,
      });

      try {
        await issueOtp(
          { user_id: user.user_id, email: input.email },
          "VERIFY_EMAIL",
          lang,
        );
      } catch (error) {
        // No code means no way to verify, so remove the account and fail the signup.
        await userRepository.deleteUnverified([user.user_id]);
        throw error;
      }

      return {
        userId: user.user_id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role_id,
        createdAt: user.created_at,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("user.alreadyExists");
      }
      throw error;
    }
  },
  async login(input: LoginInput) {
    const user = await userRepository.findForLogin(input.username);

    const passwordOk = await verifyPassword(
      input.password,
      user?.password_hash,
    );

    if (!user || !passwordOk) {
      logger.warn("Login failed", { reason: "invalid_credentials" });
      throw new UnauthorizedError("user.invalidCredentials");
    }

    if (!user.is_active) {
      logger.warn("Login refused", { reason: "inactive_user" });
      throw new ForbiddenError("user.accountInactive");
    }

    // Correct password, but the email was never verified.
    // if (!user.is_email_verified) {
    //   logger.warn("Login refused", { reason: "email_not_verified" });
    //   throw new ForbiddenError("user.emailNotVerified");
    // }

    const accessToken = generateAccessToken(user.user_id);
    const { expiresAt } = verifyJwtToken(accessToken);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresAt,
      userId: user.user_id,
    };
  },

  async getProfile(userId: number) {
    const user = await userRepository.findProfileById(userId);
    if (!user || !user.is_active)
      throw new UnauthorizedError("user.unauthorized");
    return {
      userId: user.user_id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      mobile: user.mobile,
      roleId: user.role_id,
    };
  },
  // Update profile (full name and mobile).
  // The caller NEVER provides a userId from the request body; it must come from the JWT.
  async updateProfile(userId: number, data: UpdateProfileInput) {
    // Load the current state from the database.
    const existing = await userRepository.findBasicById(userId);
    if (!existing) throw new UnauthorizedError("user.unauthorized");

    // Reject the new mobile if it is already owned by another account.
    if (data.mobile && data.mobile !== existing.mobile) {
      const conflict = await userRepository.findByMobile(data.mobile);
      if (conflict && conflict.user_id !== userId) {
        throw new ConflictError("user.mobileAlreadyExists");
      }
    }

    try {
      const updated = await userRepository.updateProfile(userId, {
        full_name: data.full_name,
        mobile: data.mobile,
      });

      return {
        userId: updated.user_id,
        username: updated.username,
        fullName: updated.full_name,
        email: updated.email,
        mobile: updated.mobile,
        roleId: updated.role_id,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("user.mobileAlreadyExists");
      }
      throw error;
    }
  },

  async verifyEmail(input: VerifyEmailInput) {
    const user = await userRepository.findByEmail(input.email);
    if (!user || !user.is_active || user.is_email_verified) {
      throw new BadRequestError("user.otpInvalid");
    }
    const otpId = await checkOtp(user.user_id, "VERIFY_EMAIL", input.otp);
    await userRepository.markEmailVerified(user.user_id, otpId);
    return { emailVerified: true };
  },

  async resendOtp(input: EmailOnlyInput, lang?: string) {
    const user = await userRepository.findByEmail(input.email);
    if (user && user.is_active && !user.is_email_verified && user.email) {
      await sendOtpQuietly(
        { user_id: user.user_id, email: user.email },
        "VERIFY_EMAIL",
        lang,
      );
    }
    return null; // same answer whether or not the email exists
  },

  async forgotPassword(input: EmailOnlyInput, lang?: string) {
    const user = await userRepository.findByEmail(input.email);

    // Unknown or inactive email: stop here so the page does not move to the code step.
    if (!user || !user.is_active || !user.email) {
      throw new APIResponse("user.emailNotRegistered", 404);
    }
    // Registered but never verified: only verified accounts can reset a password.
    if (!user.is_email_verified) {
      throw new ForbiddenError("user.emailNotVerified");
    }

    // issueOtp (not the quiet version) so cooldown and email failures reach the user.
    await issueOtp(
      { user_id: user.user_id, email: user.email },
      "RESET_PASSWORD",
      lang,
    );
    return null;
  },

  async resetPassword(input: ResetPasswordInput) {
    const user = await userRepository.findByEmail(input.email);
    // Same generic error for unknown, inactive and unverified accounts.
    if (!user || !user.is_active || !user.is_email_verified) {
      throw new BadRequestError("user.otpInvalid");
    }

    const otpId = await checkOtp(user.user_id, "RESET_PASSWORD", input.otp);
    const hash = await hashPassword(input.new_password);
    await userRepository.resetPasswordWithOtp(user.user_id, otpId, hash);
    return null;
  },

  async changePassword(userId: number, input: ChangePasswordInput) {
    const user = await userRepository.findPasswordHashById(userId);
    if (!user || !user.is_active)
      throw new UnauthorizedError("user.unauthorized");

    const ok = await verifyPassword(input.old_password, user.password_hash);
    if (!ok) throw new BadRequestError("user.oldPasswordIncorrect");

    const hash = await hashPassword(input.new_password);
    await userRepository.updatePassword(userId, hash);
    return null;
  },
};
