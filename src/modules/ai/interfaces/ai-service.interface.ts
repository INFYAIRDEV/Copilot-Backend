import {
  AIServiceRequest,
  AIServiceResult,
} from "../types/ai-service.types.js";
import {
  OutputSchemaDefinition,
  StructuredOutputResult,
} from "../structured/structured-output.types.js";
import { NormalizedAnalyticalContext } from "../types/ai-service.types.js";

/**
 * IAIService Interface
 *
 * Defines the application-owned contract for Copilot AI operations.
 * Isolates all Copilot business logic and orchestration workflows from
 * underlying LLM providers, SDKs, HTTP transport, and vendor-specific data structures.
 *
 * Sits between:
 * Copilot Orchestration Service → AIService → IAIProvider (Resilience / Adapter)
 *
 * Strict Architectural Boundaries:
 * - Does NOT execute SQL
 * - Does NOT evaluate authorization decisions
 * - Does NOT perform deterministic metric calculations
 * - Stops at candidate-plan generation stage
 */
export interface IAIService {
  /**
   * Accepts normalized analytical context, applies input constraints,
   * invokes the provider abstraction, validates the candidate plan's structural
   * integrity, and returns an application-owned result.
   */
  generateCandidatePlan(request: AIServiceRequest): Promise<AIServiceResult>;

  generateStructuredOutput?<T>(request: {
    prompt: string;
    schema: OutputSchemaDefinition<T>;
    context: NormalizedAnalyticalContext;
    tokenBudget?: import("../types/ai-provider.types.js").AITokenBudget;
    correlationId?: string;
  }): Promise<StructuredOutputResult<T>>;

  /**
   * Optionally streams candidate response content incrementally via onChunk callback.
   */
  generateCandidatePlanStream?(
    request: AIServiceRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AIServiceResult>;
}
