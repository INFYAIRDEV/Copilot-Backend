// Database access for users. Only this file talks to Prisma for the user module.
import { RoleCode } from "../../shared/constants/roles.js";
import { prisma } from "../../shared/utils/prismaClient.js";

// The only user fields that may ever leave the backend (never password_hash).
const publicUserSelect = {
  user_id: true,
  username: true,
  full_name: true,
  email: true,
  role_id: true,
  created_at: true,
} as const;

export const userRepository = {
  // Finds a user that already uses this username or email.
  findByUsernameOrEmail: (username: string, email: string) =>
    prisma.users.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { user_id: true },
    }),

  // Creates the user. The role is always set here, never by the client.
  create: (data: {
    username: string;
    full_name: string;
    email: string;
    password_hash: string;
  }) =>
    prisma.users.create({
      data: { ...data, role_id: RoleCode.USER },
      select: publicUserSelect,
    }),

  // Finds the user for login. Selects only what login needs; none of it is sent to the client.
  findForLogin: (username: string) =>
    prisma.users.findUnique({
      where: { username },
      select: { user_id: true, password_hash: true, is_active: true },
    }),

  // Profile read. Fields are listed one by one, so password_hash and
  // refresh_token can never be selected by accident.
  findProfileById: (userId: number) =>
    prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        username: true,
        full_name: true,
        email: true,
        role_id: true,
        is_active: true,
      },
    }),
};
