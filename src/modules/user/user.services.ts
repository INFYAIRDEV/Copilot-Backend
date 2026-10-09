// Business rules for users.
import { Prisma } from "@prisma/client";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../../shared/errors/error.js";
import { hashPassword } from "../../shared/utils/password.js";
import type { RegisterInput } from "./user.validation.js";
import { userRepository } from "./user.repository.js";
import { logger } from "../../shared/utils/logger.js";
import { verifyPassword } from "../../shared/utils/password.js";
import { generateAccessToken, verifyJwtToken } from "../../shared/utils/jwt.js";
import type { LoginInput } from "./user.validation.js";

export const userService = {
  async register(input: RegisterInput) {
    // Friendly check first; the database unique rule below is the final protection.
    const existing = await userRepository.findByUsernameOrEmail(
      input.username,
      input.email,
    );
    if (existing) throw new ConflictError("user.alreadyExists");

    const password_hash = await hashPassword(input.password);

    try {
      const user = await userRepository.create({
        username: input.username,
        full_name: input.full_name,
        email: input.email,
        password_hash,
      });
      // Only these fields are returned to the client.
      return {
        userId: user.user_id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role_id,
        createdAt: user.created_at,
      };
    } catch (error) {
      // Two requests at the same time: the database rejects the second one.
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

    // The check always runs, even for an unknown user, so the response time looks the same.
    const passwordOk = await verifyPassword(
      input.password,
      user?.password_hash,
    );

    // Unknown user and wrong password give the same generic answer.
    if (!user || !passwordOk) {
      logger.warn("Login failed", { reason: "invalid_credentials" });
      throw new UnauthorizedError("user.invalidCredentials");
    }

    // Correct password, but the account is switched off.
    if (!user.is_active) {
      logger.warn("Login refused", { reason: "inactive_user" });
      throw new ForbiddenError("user.accountInactive");
    }

    // The token is created by the central JWT component (COP-12).
    const accessToken = generateAccessToken(user.user_id);
    // Read the expiry back from the new token so it always matches JWT_EXPIRES_IN.
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
    // A valid token for a deleted or switched-off account is not a usable identity.
    if (!user || !user.is_active)
      throw new UnauthorizedError("user.unauthorized");
    // Only approved fields. No locale: the users table has none.
    return {
      userId: user.user_id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
    };
  },
};
