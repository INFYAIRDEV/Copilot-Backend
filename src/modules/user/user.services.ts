// Business rules for users.
import { Prisma } from "@prisma/client";
import { ConflictError } from "../../shared/errors/error.js";
import { hashPassword } from "../../shared/utils/password.js";
import type { RegisterInput } from "./user.validation.js";
import { userRepository } from "./user.repository.js";

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
};
