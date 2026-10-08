import { NormalizedAnalyticalContext } from "../types/ai-service.types.js";
import { AIOperationType } from "../prompts/prompt.types.js";

/**
 * Supported Copilot locales as defined in the master blueprint and database schema.
 */
export const SUPPORTED_LOCALES = ["en", "it"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Standard token budget configuration boundaries.
 */
export interface TokenBudgetConfig {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxConversationTokens?: number;
}

/**
 * Default limits for AI requests.
 */
export const AI_REQUEST_LIMITS = {
  MIN_PROMPT_LENGTH: 3,
  MAX_PROMPT_LENGTH: 2000,
  DEFAULT_MAX_INPUT_TOKENS: 2048,
  DEFAULT_MAX_OUTPUT_TOKENS: 1024,
  DEFAULT_MAX_CONVERSATION_TOKENS: 4096,
  ABSOLUTE_MAX_INPUT_TOKENS: 8192,
  ABSOLUTE_MAX_OUTPUT_TOKENS: 4096,
  ABSOLUTE_MAX_CONVERSATION_TOKENS: 16384,
} as const;

/**
 * Configuration options for the AI Request Validator.
 */
export interface AIRequestValidationOptions {
  minPromptLength?: number;
  maxPromptLength?: number;
  maxInputTokensLimit?: number;
  maxOutputTokensLimit?: number;
  maxConversationTokensLimit?: number;
  disallowProhibitedPatterns?: boolean;
  rejectOnSensitivePatterns?: boolean;
}

/**
 * Raw / incoming AI Request envelope before validation.
 */
export interface AIRequestInput {
  prompt: string;
  context: NormalizedAnalyticalContext;
  operation?: AIOperationType | string;
  promptKey?: string;
  promptVersion?: string;
  locale?: string;
  tokenBudget?: TokenBudgetConfig;
  correlationId?: string;
  conversationId?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Validated, application-owned, immutable AI Request representation.
 * Guaranteed to satisfy all structural, security, and operational constraints.
 */
export interface ValidatedAIRequest {
  readonly prompt: string;
  readonly context: Readonly<NormalizedAnalyticalContext>;
  readonly operation: AIOperationType;
  readonly promptKey: string;
  readonly promptVersion?: string;
  readonly locale: SupportedLocale;
  readonly tokenBudget: {
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxConversationTokens: number;
  };
  readonly correlationId: string;
  readonly conversationId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly validatedAt: string;
}

/**
 * Validation result returned by safe validation methods.
 */
export interface AIRequestValidationResult {
  isValid: boolean;
  validatedRequest?: ValidatedAIRequest;
  errors: string[];
}
