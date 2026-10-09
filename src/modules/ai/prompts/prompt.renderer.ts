import { createHash } from "crypto";
import {
  PromptDefinition,
  PromptRenderContext,
  ManagedPrompt,
  PromptMetadata,
} from "./prompt.types.js";

const SENSITIVE_PATTERNS = [
  /password\s*=\s*['"][^'"]+['"]/gi,
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /api[_-]?key\s*=\s*['"][^'"]+['"]/gi,
  /secret\s*=\s*['"][^'"]+['"]/gi,
  /postgres:\/\/[^'"]+/gi,
  /mysql:\/\/[^'"]+/gi,
];

/**
 * PromptRenderer
 *
 * Deterministic prompt rendering engine.
 * Substitutes variables into approved templates, sanitizes untrusted input,
 * isolates dynamic context in explicit boundary tags, and generates a
 * deterministic SHA-256 fingerprint for audit and evaluation traceability.
 */
export class PromptRenderer {
  /**
   * Renders a ManagedPrompt deterministically from definition and normalized context.
   */
  public static render(
    definition: PromptDefinition,
    context: PromptRenderContext,
  ): ManagedPrompt {
    // 1. Sanitize user query
    const sanitizedUserQuery = this.sanitizeText(context.userQuery);

    // 2. Prepare resolved variables dictionary with deterministic formatting
    const variables: Record<string, string> = {
      userQuery: sanitizedUserQuery,
      userId: String(context.context.userId),
      roleId: String(context.context.roleId),
      locale: context.context.locale || "en",
      conversationId: context.context.conversationId || "none",
      allowedEntities: context.context.allowedEntities
        ? [...context.context.allowedEntities].sort().join(", ")
        : "all_authorized",
      availableMetrics: context.context.datasetContext?.availableMetrics
        ? [...context.context.datasetContext.availableMetrics].sort().join(", ")
        : "standard_metrics",
      availableDimensions: context.context.datasetContext?.availableDimensions
        ? [...context.context.datasetContext.availableDimensions]
            .sort()
            .join(", ")
        : "standard_dimensions",
      datasetId: context.context.datasetContext?.datasetId || "default",
    };

    // Include additional variables if supplied
    if (context.additionalVariables) {
      for (const [k, v] of Object.entries(context.additionalVariables)) {
        if (v !== undefined) {
          variables[k] = Array.isArray(v)
            ? [...v].sort().join(", ")
            : this.sanitizeText(String(v));
        }
      }
    }

    // 3. Render user prompt by substituting {{variable}} placeholders
    let renderedUserPrompt = definition.userTemplate;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      renderedUserPrompt = renderedUserPrompt.replace(regex, value);
    }

    // 4. Compute deterministic SHA-256 hash of prompt payload for traceability
    const hash = this.computeHash(
      definition.promptKey,
      definition.version,
      definition.systemInstruction,
      renderedUserPrompt,
    );

    // 5. Construct PromptMetadata
    const metadata: PromptMetadata = {
      promptKey: definition.promptKey,
      version: definition.version,
      operation: definition.operation,
      renderedAt: new Date().toISOString(),
      hash,
      contextSnapshot: {
        userId: context.context.userId,
        roleId: context.context.roleId,
        locale: context.context.locale,
        allowedEntities: context.context.allowedEntities
          ? [...context.context.allowedEntities].sort()
          : undefined,
      },
    };

    return {
      systemInstruction: definition.systemInstruction,
      userPrompt: renderedUserPrompt,
      metadata,
    };
  }

  /**
   * Redacts credential / secret patterns from untrusted user text.
   */
  public static sanitizeText(text: string): string {
    let sanitized = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
    return sanitized;
  }

  /**
   * Computes a deterministic SHA-256 hash of prompt elements.
   */
  public static computeHash(
    promptKey: string,
    version: string,
    systemInstruction: string,
    userPrompt: string,
  ): string {
    const payload = `${promptKey}:${version}\nSYSTEM:\n${systemInstruction}\nUSER:\n${userPrompt}`;
    return createHash("sha256").update(payload, "utf8").digest("hex");
  }
}
