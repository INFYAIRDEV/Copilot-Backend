import { z } from "zod";

const localeSchema = z.enum(["en", "it"], {
  message: "copilot.validation.invalidLocale",
});

const uuidSchema = z
  .string({ message: "copilot.validation.invalidUuid" })
  .uuid({ message: "copilot.validation.invalidUuid" });

const limitSchema = z.coerce
  .number({ message: "copilot.validation.invalidLimit" })
  .int({ message: "copilot.validation.invalidLimit" })
  .min(1, { message: "copilot.validation.invalidLimit" })
  .max(100, { message: "copilot.validation.invalidLimit" })
  .default(50);

const cursorSchema = z
  .string({ message: "copilot.validation.invalidCursor" })
  .max(2048, { message: "copilot.validation.invalidCursor" })
  .optional();

export const createConversationSchema = z.object({
  body: z
    .object({ locale: localeSchema.optional() })
    .strict({ message: "copilot.validation.invalidRequest" }),
});

export const sendMessageSchema = z.object({
  params: z.object({ id: uuidSchema }),
  headers: z.object({
    "idempotency-key": z
      .string({ message: "copilot.validation.idempotencyKeyRequired" })
      .trim()
      .min(1, { message: "copilot.validation.idempotencyKeyRequired" })
      .max(128, { message: "copilot.validation.idempotencyKeyTooLong" }),
    "x-request-id": z
      .string()
      .uuid({ message: "copilot.validation.invalidRequestId" })
      .optional(),
  }),
  body: z
    .object({
      role: z
        .enum(["USER", "ASSISTANT"], {
          message: "copilot.validation.invalidRole",
        })
        .optional()
        .default("USER"),
      kind: z.enum(
        ["QUESTION", "CLARIFICATION_REPLY", "CLARIFICATION_REQUEST"],
        { message: "copilot.validation.invalidKind" },
      ),
      text: z
        .string({ message: "copilot.validation.textRequired" })
        .trim()
        .min(1, { message: "copilot.validation.textRequired" })
        .max(20000, { message: "copilot.validation.textTooLong" }),
      locale: localeSchema.optional(),
    })
    .strict({ message: "copilot.validation.invalidRequest" }),
});

export const historySchema = z.object({
  params: z.object({ id: uuidSchema }),
  query: z.object({ limit: limitSchema, cursor: cursorSchema }),
});

export const listConversationsSchema = z.object({
  query: z.object({ limit: limitSchema, cursor: cursorSchema }),
});
