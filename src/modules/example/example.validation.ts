import { t } from "i18next";
import * as ZOD from "zod";
const z = ZOD.z;

const base = z;

export const userValidation = (z: typeof base) =>
  z.object({
    full_name: z
      .string({ message: "user.fullNameRequired" })
      .nonempty({ message: "user.fullNameRequired" })
      .min(2, { message: "user.fullNameMin" })
      .max(100, { message: "user.fullNameMax" }),

    username: z
      .string({ message: "user.usernameRequired" })
      .nonempty({ message: "user.usernameRequired" })
      .min(2, { message: "user.usernameMin" })
      .max(100, { message: "user.usernameMax" }),

    email: z
      .string({ message: "user.emailRequired" })
      .nonempty({ message: "user.emailRequired" })
      .email({ message: "user.emailInvalid" }),

    mobile: z
      .string({ message: "user.mobileRequired" })
      .nonempty({ message: "user.mobileRequired" })
      .min(10, { message: "user.mobileMin" })
      .max(10, { message: "user.mobileMax" })
      .regex(/^[0-9]+$/, { message: "user.mobileDigitsOnly" }),
  });
