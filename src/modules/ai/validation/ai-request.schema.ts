import { z } from "zod";
import { SUPPORTED_LOCALES, AI_REQUEST_LIMITS } from "./ai-request.types.js";

/**
 * Zod schema for supported Copilot locales.
 */
export const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES, {
  errorMap: () => ({
    message: `Invalid locale. Supported locales: ${SUPPORTED_LOCALES.join(", ")}`,
  }),
});

/**
 * Zod schema for approved AI Operations.
 */
export const aiOperationSchema = z.enum(
  [
    "CANDIDATE_PLAN",
    "ANALYTICAL_INTENT",
    "CLARIFICATION",
    "NARRATIVE_INTERPRETATION",
  ],
  {
    errorMap: () => ({
      message:
        "Invalid AI operation. Supported operations: CANDIDATE_PLAN, ANALYTICAL_INTENT, CLARIFICATION, NARRATIVE_INTERPRETATION",
    }),
  },
);

/**
 * Zod schema for token budget boundaries.
 */
export const tokenBudgetSchema = z
  .object({
    maxInputTokens: z
      .number()
      .int()
      .positive("maxInputTokens must be a positive integer")
      .max(
        AI_REQUEST_LIMITS.ABSOLUTE_MAX_INPUT_TOKENS,
        `maxInputTokens cannot exceed ${AI_REQUEST_LIMITS.ABSOLUTE_MAX_INPUT_TOKENS}`,
      )
      .optional()
      .default(AI_REQUEST_LIMITS.DEFAULT_MAX_INPUT_TOKENS),
    maxOutputTokens: z
      .number()
      .int()
      .positive("maxOutputTokens must be a positive integer")
      .max(
        AI_REQUEST_LIMITS.ABSOLUTE_MAX_OUTPUT_TOKENS,
        `maxOutputTokens cannot exceed ${AI_REQUEST_LIMITS.ABSOLUTE_MAX_OUTPUT_TOKENS}`,
      )
      .optional()
      .default(AI_REQUEST_LIMITS.DEFAULT_MAX_OUTPUT_TOKENS),
    maxConversationTokens: z
      .number()
      .int()
      .positive("maxConversationTokens must be a positive integer")
      .max(
        AI_REQUEST_LIMITS.ABSOLUTE_MAX_CONVERSATION_TOKENS,
        `maxConversationTokens cannot exceed ${AI_REQUEST_LIMITS.ABSOLUTE_MAX_CONVERSATION_TOKENS}`,
      )
      .optional()
      .default(AI_REQUEST_LIMITS.DEFAULT_MAX_CONVERSATION_TOKENS),
  })
  .optional()
  .default({
    maxInputTokens: AI_REQUEST_LIMITS.DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: AI_REQUEST_LIMITS.DEFAULT_MAX_OUTPUT_TOKENS,
    maxConversationTokens: AI_REQUEST_LIMITS.DEFAULT_MAX_CONVERSATION_TOKENS,
  });

/**
 * Zod schema for Dataset Context within normalized analytical context.
 */
export const datasetContextSchema = z
  .object({
    datasetId: z.string().trim().min(1, "datasetId cannot be empty").optional(),
    availableMetrics: z.array(z.string().trim().min(1)).optional(),
    availableDimensions: z.array(z.string().trim().min(1)).optional(),
  })
  .optional();

/**
 * Zod schema for Normalized Analytical Context.
 * Ensures only controlled, application-owned context enters AI processing.
 */
export const normalizedContextSchema = z.object({
  userId: z
    .number({
      required_error: "userId is mandatory in normalized analytical context",
      invalid_type_error: "userId must be a number",
    })
    .int("userId must be an integer")
    .positive("userId must be a positive integer"),
  roleId: z
    .string({
      required_error: "roleId is mandatory in normalized analytical context",
      invalid_type_error: "roleId must be a string",
    })
    .trim()
    .min(1, "roleId cannot be empty"),
  locale: supportedLocaleSchema.optional().default("en"),
  conversationId: z.string().trim().optional(),
  allowedEntities: z.array(z.string().trim().min(1)).optional(),
  datasetContext: datasetContextSchema,
});

/**
 * Zod schema for the entire incoming AI Request Envelope.
 */
export const aiRequestSchema = z.object({
  prompt: z
    .string({
      required_error: "prompt is required",
      invalid_type_error: "prompt must be a string",
    })
    .trim()
    .min(
      AI_REQUEST_LIMITS.MIN_PROMPT_LENGTH,
      `prompt must be at least ${AI_REQUEST_LIMITS.MIN_PROMPT_LENGTH} characters`,
    )
    .max(
      AI_REQUEST_LIMITS.MAX_PROMPT_LENGTH,
      `prompt exceeds maximum allowed length of ${AI_REQUEST_LIMITS.MAX_PROMPT_LENGTH} characters`,
    ),
  context: normalizedContextSchema,
  operation: z.string().optional().default("CANDIDATE_PLAN"),
  promptKey: z.string().optional().default("CANDIDATE_ANALYTICAL_PLAN"),
  promptVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "promptVersion must be semver").optional(),
  locale: supportedLocaleSchema.optional(),
  tokenBudget: tokenBudgetSchema,
  correlationId: z.string().optional(),
  conversationId: z.string().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
