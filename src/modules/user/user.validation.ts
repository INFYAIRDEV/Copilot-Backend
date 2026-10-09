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
