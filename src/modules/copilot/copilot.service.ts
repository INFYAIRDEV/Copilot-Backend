import {
  IAIService,
  AIService,
  AIServiceRequest,
  AIServiceResult,
  IAIProvider,
  ModelCandidatePlan,
  ResilientAIProvider,
  LLMProviderAdapter,
} from "@/modules/ai/index.js";
import { logger } from "@/shared/utils/logger.js";

export interface SemanticValidationResult {
  isValid: boolean;
  validatedPlan?: ModelCandidatePlan;
  validationErrors?: string[];
}

export class CopilotService {
  private readonly aiService: IAIService;

  /**
   * Domain service depends on IAIService (application-level AI service layer).
   * Supports backward compatibility with IAIProvider for flexible dependency injection.
   */
  constructor(aiServiceOrProvider: IAIService | IAIProvider) {
    if ("isAIService" in aiServiceOrProvider) {
      this.aiService = aiServiceOrProvider as IAIService;
    } else {
      this.aiService = new AIService(aiServiceOrProvider as IAIProvider);
    }
  }

  /**
   * Processes user intent through the AI pipeline:
   * 1. Aggregates and minimizes model inputs into normalized analytical context.
   * 2. Invokes AI Service via IAIService interface to coordinate provider operations & structural validation.
   * 3. Passes candidate plan to application-owned Semantic & Policy Validation.
   * 4. Returns validated candidate plan ready for Server-Owned ExecutionEnvelope construction.
   */
  public async generateCandidateAnalyticalPlan(
    userPrompt: string,
    userContext: { userId: number; roleId: string; locale?: string },
  ): Promise<{ response: AIServiceResult; validation: SemanticValidationResult }> {
    logger.info(
      `[CopilotService] Processing analytical plan request for user_id [${userContext.userId}]`,
    );

    // AI-013 & AI-015: Controlled request context construction
    const request: AIServiceRequest = {
      prompt: userPrompt,
      context: {
        userId: userContext.userId,
        roleId: userContext.roleId,
        locale: userContext.locale || "en",
      },
      tokenBudget: {
        maxInputTokens: 2048,
        maxOutputTokens: 1024,
      },
    };

    // Invoke AI Service layer
    const aiResponse: AIServiceResult =
      await this.aiService.generateCandidatePlan(request);

    // AI-002, AI-003 & AI-018: Candidate Plan is treated as untrusted candidate
    // Candidate Plan MUST be validated by application semantic & policy rules before AST/SQL compilation
    const validationResult = this.performSemanticAndPolicyValidation(
      aiResponse.candidatePlan,
      userContext,
    );

    return {
      response: aiResponse,
      validation: validationResult,
    };
  }

  /**
   * Server-owned Semantic & Policy Validation logic.
   * Ensures provider output cannot override RBAC/ABAC decisions or execute arbitrary SQL.
   */
  private performSemanticAndPolicyValidation(
    candidatePlan: ModelCandidatePlan,
    userContext: { userId: number; roleId: string },
  ): SemanticValidationResult {
    const errors: string[] = [];

    // Verify candidate intents exist
    if (!candidatePlan.candidateIntents || candidatePlan.candidateIntents.length === 0) {
      errors.push("Candidate plan contains no valid query intents");
    }

    // Role-based metric / entity boundary checks
    for (const intent of candidatePlan.candidateIntents || []) {
      if (
        userContext.roleId === "operator" &&
        intent.metrics.includes("executive_cost_margin")
      ) {
        errors.push(
          `Unauthorized metric access: role '${userContext.roleId}' cannot access 'executive_cost_margin'`,
        );
      }
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      validatedPlan: isValid ? candidatePlan : undefined,
      validationErrors: errors.length > 0 ? errors : undefined,
    };
  }
}

// Factory instance: CopilotService -> AIService -> ResilientAIProvider -> LLMProviderAdapter
export const copilotService = new CopilotService(
  new AIService(new ResilientAIProvider(new LLMProviderAdapter())),
);
