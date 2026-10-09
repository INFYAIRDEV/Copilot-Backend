// Request validation for the user module.
// Messages are translation keys (see the "user" block in common.json).
import * as ZOD from "zod";
import { MAX_PASSWORD_BYTES } from "../../shared/utils/password.js";

const base = ZOD.z;

// Rules for a NEW password (registration and any future password change).
// Do not use this for login: login only checks that a password was sent.
export const passwordSchema = (z: typeof base) =>
  z
    // Must be text.
    .string({ message: "user.passwordRequired" })
    // Must not be empty.
    .min(1, { message: "user.passwordRequired" })
    // Must be at least 8 characters long.
    .min(8, { message: "user.passwordMin" })
    // Must contain at least one small letter.
    .regex(/[a-z]/, { message: "user.passwordLowercase" })
    // Must contain at least one capital letter.
    .regex(/[A-Z]/, { message: "user.passwordUppercase" })
    // Must contain at least one number.
    .regex(/[0-9]/, { message: "user.passwordDigit" })
    // Must fit bcrypt's 72-byte limit (kept last because refine() hides the string helpers).
    .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES, {
      message: "user.passwordMax",
    });

// Registration request. Unknown fields (for example role_id) are rejected,
// so the client can never choose its own role.
export const registerSchema = (z: typeof base) =>
  z
    .object({
      full_name: z
        .string({ message: "user.fullNameRequired" })
        .trim()
        .min(1, { message: "user.fullNameRequired" })
        .min(2, { message: "user.fullNameMin" })
        .max(100, { message: "user.fullNameMax" }),
      username: z
        .string({ message: "user.usernameRequired" })
        .trim()
        .toLowerCase()
        .min(1, { message: "user.usernameRequired" })
        .min(3, { message: "user.usernameMin" })
        .max(50, { message: "user.usernameMax" })
        .regex(/^[a-z0-9._-]+$/, { message: "user.usernameFormat" }),
      email: z
        .string({ message: "user.emailRequired" })
        .trim()
        .toLowerCase()
        .min(1, { message: "user.emailRequired" })
        .max(254, { message: "user.emailInvalid" })
        .email({ message: "user.emailInvalid" }),
      password: passwordSchema(z),
      confirm_password: z
        .string({ message: "user.confirmPasswordRequired" })
        .min(1, { message: "user.confirmPasswordRequired" }),
    })
    .strict({ message: "user.invalidRequest" })
    .refine((data) => data.password === data.confirm_password, {
      message: "user.confirmPasswordMismatch",
      path: ["confirm_password"],
    });

export type RegisterInput = ZOD.infer<ReturnType<typeof registerSchema>>;

// Login request. Unknown fields are rejected, so the client can never send its own
// user id or role. Only the shape is checked here; the password rules are not
// repeated on purpose (they apply to new passwords only).
export const loginSchema = (z: typeof base) =>
  z
    .object({
      username: z
        .string({ message: "user.usernameRequired" })
        .trim()
        .toLowerCase()
        .min(1, { message: "user.usernameRequired" })
        .max(50, { message: "user.invalidRequest" }),
      // The password is never trimmed, so spaces count as typed.
      password: z
        .string({ message: "user.passwordRequired" })
        .min(1, { message: "user.passwordRequired" })
        .max(128, { message: "user.invalidRequest" }),
    })
    .strict({ message: "user.invalidRequest" });

export type LoginInput = ZOD.infer<ReturnType<typeof loginSchema>>;
