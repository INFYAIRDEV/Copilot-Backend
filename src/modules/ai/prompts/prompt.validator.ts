import {
  PromptDefinition,
  PromptRenderContext,
  PromptValidationResult,
  AIOperationType,
} from "./prompt.types.js";

const VALID_OPERATIONS = new Set<AIOperationType>([
  "CANDIDATE_PLAN",
  "ANALYTICAL_INTENT",
  "CLARIFICATION",
  "NARRATIVE_INTERPRETATION",
]);

const PROHIBITED_PATTERNS = [
  /password\s*=\s*['"][^'"]+['"]/gi,
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /api[_-]?key\s*=\s*['"][^'"]+['"]/gi,
  /secret\s*=\s*['"][^'"]+['"]/gi,
  /postgres:\/\/[^'"]+/gi,
  /mysql:\/\/[^'"]+/gi,
  /PRIVATE KEY-----/gi,
];

const UNRESOLVED_PLACEHOLDER_REGEX = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

/**
 * PromptValidator
 *
 * Enforces strict validation rules on prompt definitions, dynamic context variables,
 * rendered prompt content, and security boundaries.
 */
export class PromptValidator {
  /**
   * Validates structural integrity and correctness of a prompt definition.
   */
  public static validateDefinition(
    definition: unknown,
  ): PromptValidationResult {
    const errors: string[] = [];

    if (!definition || typeof definition !== "object") {
      return {
        isValid: false,
        errors: ["Prompt definition must be a non-null object"],
      };
    }

    const def = definition as Partial<PromptDefinition>;

    if (
      !def.promptKey ||
      typeof def.promptKey !== "string" ||
      def.promptKey.trim().length === 0
    ) {
      errors.push("Missing or invalid 'promptKey': must be a non-empty string");
    }

    if (
      !def.version ||
      typeof def.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(def.version)
    ) {
      errors.push(
        "Missing or invalid 'version': must follow semantic versioning (e.g. '1.0.0')",
      );
    }

    if (
      !def.operation ||
      !VALID_OPERATIONS.has(def.operation as AIOperationType)
    ) {
      errors.push(
        `Invalid 'operation': got '${def.operation}'. Supported: ${Array.from(VALID_OPERATIONS).join(", ")}`,
      );
    }

    if (
      !def.systemInstruction ||
      typeof def.systemInstruction !== "string" ||
      def.systemInstruction.trim().length === 0
    ) {
      errors.push(
        "Missing or invalid 'systemInstruction': must be non-empty string",
      );
    }

    if (
      !def.userTemplate ||
      typeof def.userTemplate !== "string" ||
      def.userTemplate.trim().length === 0
    ) {
      errors.push(
        "Missing or invalid 'userTemplate': must be non-empty string",
      );
    }

    if (!Array.isArray(def.requiredVariables)) {
      errors.push(
        "Missing or invalid 'requiredVariables': must be an array of strings",
      );
    }

    // Verify system instructions and templates contain no embedded secrets
    for (const pattern of PROHIBITED_PATTERNS) {
      if (def.systemInstruction && pattern.test(def.systemInstruction)) {
        errors.push(
          "Security violation: 'systemInstruction' contains prohibited secret or credential pattern",
        );
      }
      if (def.userTemplate && pattern.test(def.userTemplate)) {
        errors.push(
          "Security violation: 'userTemplate' contains prohibited secret or credential pattern",
        );
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Verifies that all required variables declared by a prompt definition
   * can be satisfied from the supplied context.
   */
  public static validateContext(
    definition: PromptDefinition,
    context: PromptRenderContext,
  ): PromptValidationResult {
    const errors: string[] = [];

    if (!context || typeof context !== "object") {
      return { isValid: false, errors: ["Context must be a non-null object"] };
    }

    if (
      !context.userQuery ||
      typeof context.userQuery !== "string" ||
      context.userQuery.trim().length === 0
    ) {
      errors.push(
        "Missing required field: 'userQuery' must be a non-empty string",
      );
    }

    if (
      !context.context ||
      typeof context.context.userId !== "number" ||
      !context.context.roleId
    ) {
      errors.push(
        "Missing required analytical context: 'userId' (number) and 'roleId' (string) are mandatory",
      );
    }

    // Check specific required variables declared in definition
    const availableVars = new Set<string>([
      "userQuery",
      "userId",
      "roleId",
      "locale",
      "conversationId",
      "allowedEntities",
      "datasetId",
      "availableMetrics",
      "availableDimensions",
      ...Object.keys(context.additionalVariables || {}),
    ]);

    for (const reqVar of definition.requiredVariables) {
      if (!availableVars.has(reqVar)) {
        errors.push(`Missing required template variable: '${reqVar}'`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Validates the final rendered prompt output:
   * - Ensures no unresolved placeholders (e.g. {{variable}}) remain.
   * - Ensures no sensitive credentials leaked into output.
   */
  public static validateRenderedPrompt(prompt: {
    systemInstruction: string;
    userPrompt: string;
  }): PromptValidationResult {
    const errors: string[] = [];

    // Check for unresolved placeholders
    const systemMatches = prompt.systemInstruction.match(
      UNRESOLVED_PLACEHOLDER_REGEX,
    );
    if (systemMatches && systemMatches.length > 0) {
      errors.push(
        `Unresolved placeholders in system instruction: ${systemMatches.join(", ")}`,
      );
    }

    const userMatches = prompt.userPrompt.match(UNRESOLVED_PLACEHOLDER_REGEX);
    if (userMatches && userMatches.length > 0) {
      errors.push(
        `Unresolved placeholders in rendered user prompt: ${userMatches.join(", ")}`,
      );
    }

    // Check for prohibited sensitive patterns in final output
    for (const pattern of PROHIBITED_PATTERNS) {
      if (pattern.test(prompt.userPrompt)) {
        errors.push(
          "Prohibited sensitive pattern (secret/token/credential) detected in rendered prompt",
        );
      }
      if (pattern.test(prompt.systemInstruction)) {
        errors.push(
          "Prohibited sensitive pattern detected in system instruction",
        );
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}
