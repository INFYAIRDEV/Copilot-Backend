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
      data: { ...data, role_id: RoleCode.USER, is_email_verified: false },
      select: publicUserSelect,
    }),

  // Finds the user for login. Selects only what login needs; none of it is sent to the client.
  findForLogin: (username: string) =>
    prisma.users.findUnique({
      where: { username },
      select: {
        user_id: true,
        password_hash: true,
        is_active: true,
        is_email_verified: true,
      },
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

  findByEmail: (email: string) =>
    prisma.users.findUnique({
      where: { email },
      select: {
        user_id: true,
        email: true,
        is_active: true,
        is_email_verified: true,
      },
    }),

  findPasswordHashById: (userId: number) =>
    prisma.users.findUnique({
      where: { user_id: userId },
      select: { password_hash: true, is_active: true },
    }),

  findLatestOtp: (userId: number, purpose: string) =>
    prisma.user_otp.findFirst({
      where: { user_id: userId, purpose },
      orderBy: { created_at: "desc" },
    }),

  countOtpSince: (userId: number, purpose: string, since: Date) =>
    prisma.user_otp.count({
      where: { user_id: userId, purpose, created_at: { gte: since } },
    }),

  // Cancels older unused codes, then stores the new one.
  createOtp: (
    userId: number,
    purpose: string,
    otpHash: string,
    expiresAt: Date,
  ) =>
    prisma.$transaction([
      prisma.user_otp.updateMany({
        where: { user_id: userId, purpose, consumed_at: null },
        data: { consumed_at: new Date() },
      }),
      prisma.user_otp.create({
        data: {
          user_id: userId,
          purpose,
          otp_hash: otpHash,
          expires_at: expiresAt,
        },
      }),
    ]),

  findActiveOtp: (userId: number, purpose: string) =>
    prisma.user_otp.findFirst({
      where: {
        user_id: userId,
        purpose,
        consumed_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    }),

  // Returns the new attempt count (atomic, so parallel guesses are all counted).
  incrementOtpAttempts: async (otpId: number) =>
    (
      await prisma.user_otp.update({
        where: { id: otpId },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      })
    ).attempts,

  markEmailVerified: (userId: number, otpId: number) =>
    prisma.$transaction([
      prisma.user_otp.update({
        where: { id: otpId },
        data: { consumed_at: new Date() },
      }),
      prisma.users.update({
        where: { user_id: userId },
        data: {
          is_email_verified: true,
          email_verified_at: new Date(),
          updated_at: new Date(),
        },
      }),
    ]),

  // Forgot-password reset. Also clears the refresh token.
  resetPasswordWithOtp: (userId: number, otpId: number, passwordHash: string) =>
    prisma.$transaction([
      prisma.user_otp.update({
        where: { id: otpId },
        data: { consumed_at: new Date() },
      }),
      prisma.users.update({
        where: { user_id: userId },
        data: {
          password_hash: passwordHash,
          refresh_token: null,
          updated_at: new Date(),
        },
      }),
    ]),

  updatePassword: (userId: number, passwordHash: string) =>
    prisma.users.update({
      where: { user_id: userId },
      data: {
        password_hash: passwordHash,
        refresh_token: null,
        updated_at: new Date(),
      },
    }),
};
