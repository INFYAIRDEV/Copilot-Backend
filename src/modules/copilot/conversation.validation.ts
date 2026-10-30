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

export const renameConversationSchema = z.object({
  params: z.object({ id: uuidSchema }),
  body: z
    .object({
      title: z
        .string({ message: "copilot.validation.titleRequired" })
        .trim()
        .min(1, { message: "copilot.validation.titleRequired" })
        .max(255, { message: "copilot.validation.titleTooLong" }),
    })
    .strict({ message: "copilot.validation.invalidRequest" }),
});

export const deleteConversationSchema = z.object({
  params: z.object({ id: uuidSchema }),
});

export const pinConversationSchema = z.object({
  params: z.object({ id: uuidSchema }),
  body: z
    .object({
      is_pinned: z.boolean({
        required_error: "copilot.validation.isPinnedRequired",
        invalid_type_error: "copilot.validation.invalidIsPinned",
      }),
    })
    .strict({ message: "copilot.validation.invalidRequest" }),
});


export const shareConversationSchema = z.object({
  params: z.object({ id: uuidSchema }),
  body: z
    .object({
      title: z
        .string()
        .trim()
        .max(255, { message: "copilot.validation.titleTooLong" })
        .optional(),
    })
    .optional(),
});

export const getSharedConversationSchema = z.object({
  params: z.object({
    shareId: z
      .string({ message: "copilot.validation.invalidShareId" })
      .trim()
      .min(1, { message: "copilot.validation.invalidShareId" })
      .max(64, { message: "copilot.validation.invalidShareId" }),
  }),
});

export const revokeShareSchema = z.object({
  params: z.object({ id: uuidSchema }),
});
