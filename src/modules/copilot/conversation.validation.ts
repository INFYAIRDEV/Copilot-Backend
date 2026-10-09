import { z } from "zod";

export const createConversationSchema = z.object({
  body: z.object({ locale: z.enum(["en", "it"]).optional() }).strict(),
});

export const sendMessageSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  headers: z.object({ "idempotency-key": z.string().trim().min(1).max(128) }),
  body: z
    .object({
      kind: z.enum(["QUESTION", "CLARIFICATION_REPLY"]),
      text: z.string().trim().min(1).max(20000),
      locale: z.enum(["en", "it"]).optional(),
    })
    .strict(),
});

export const historySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(2048).optional(),
  }),
});
