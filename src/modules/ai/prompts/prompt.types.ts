import { NormalizedAnalyticalContext } from "../types/ai-service.types.js";

/**
 * Standard AI Operations supported by the Copilot architecture.
 */
export type AIOperationType =
  | "CANDIDATE_PLAN"
  | "ANALYTICAL_INTENT"
  | "CLARIFICATION"
  | "NARRATIVE_INTERPRETATION";

/**
 * Versioned prompt definition maintained in the centralized prompt catalog.
 * Decouples prompt engineering and instructions from LLM provider implementations.
 */
export interface PromptDefinition {
  /** Unique key identifying the prompt template */
  promptKey: string;
  /** Semantic version string (e.g., "1.0.0") */
  version: string;
  /** Primary Copilot AI operation */
  operation: AIOperationType;
  /** Human-readable description of the prompt purpose */
  description: string;
  /** Trusted system-level instructions establishing candidate-only rules, output schemas, and security boundaries */
  systemInstruction: string;
  /** Template for user query and analytical context containing {{variable}} placeholders */
  userTemplate: string;
  /** Explicit list of variables required to render this template */
  requiredVariables: string[];
  /** Whether this prompt definition is currently active for production use */
  isActive: boolean;
  /** Optional deprecation timestamp */
  deprecatedAt?: string;
  /** Optional metadata tags for evaluation and tracking */
  metadata?: Record<string, string>;
}

/**
 * Metadata captured upon prompt construction for operational telemetry,
 * auditability, and evaluation regression runs.
 */
export interface PromptMetadata {
  promptKey: string;
  version: string;
  operation: AIOperationType;
  renderedAt: string;
  hash: string;
  contextSnapshot: {
    userId: number;
    roleId: string;
    locale?: string;
    allowedEntities?: string[];
  };
}

/**
 * Provider-neutral prompt representation returned to the AI Service.
 * Isolates trusted system instructions from dynamic untrusted context.
 */
export interface ManagedPrompt {
  /** Trusted system instruction (immutable guardrails, JSON candidate schema, security notice) */
  systemInstruction: string;
  /** Rendered user prompt containing isolated dynamic context and user query */
  userPrompt: string;
  /** Traceable metadata and hash */
  metadata: PromptMetadata;
}

/**
 * Controlled input context supplied to render a managed prompt.
 */
export interface PromptRenderContext {
  /** User's analytical query/intent */
  userQuery: string;
  /** Normalized application-owned analytical context */
  context: NormalizedAnalyticalContext;
  /** Additional approved dynamic variables if required */
  additionalVariables?: Record<
    string,
    string | number | boolean | string[] | undefined
  >;
}

/**
 * Result of prompt validation checks.
 */
export interface PromptValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Error codes for Prompt Management failures.
 */
export type PromptErrorCode =
  | "PROMPT_NOT_FOUND"
  | "PROMPT_VERSION_NOT_FOUND"
  | "PROMPT_MISSING_VARIABLES"
  | "PROMPT_UNRESOLVED_PLACEHOLDERS"
  | "PROMPT_SENSITIVE_DATA_DETECTED"
  | "PROMPT_INVALID_CONFIG"
  | "PROMPT_INJECTION_DETECTED";

/**
 * Application-level exception thrown when prompt lookup, validation, or rendering fails.
 */
export class PromptException extends Error {
  public readonly code: PromptErrorCode;
  public readonly promptKey?: string;
  public readonly version?: string;
  public readonly details?: string[];

  constructor(
    code: PromptErrorCode,
    message: string,
    options: {
      promptKey?: string;
      version?: string;
      details?: string[];
    } = {},
  ) {
    super(message);
    this.name = "PromptException";
    this.code = code;
    this.promptKey = options.promptKey;
    this.version = options.version;
    this.details = options.details;

    Object.setPrototypeOf(this, PromptException.prototype);
  }
}
