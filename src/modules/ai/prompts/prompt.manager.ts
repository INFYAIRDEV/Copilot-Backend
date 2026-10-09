import {
  PromptDefinition,
  PromptRenderContext,
  ManagedPrompt,
  PromptException,
} from "./prompt.types.js";
import { PromptRegistry, defaultPromptRegistry } from "./prompt.registry.js";
import { PromptValidator } from "./prompt.validator.js";
import { PromptRenderer } from "./prompt.renderer.js";
import { logger } from "@/shared/utils/logger.js";

/**
 * IPromptManager
 *
 * Application-owned interface for centralized prompt management.
 * Isolates prompt construction, version selection, and rendering from AI operations and provider adapters.
 */
export interface IPromptManager {
  /**
   * Deterministically constructs a validated ManagedPrompt for an AI operation.
   */
  buildPrompt(
    promptKey: string,
    context: PromptRenderContext,
    version?: string,
  ): ManagedPrompt;

  /**
   * Retrieves an approved prompt definition by key and optional version.
   */
  getDefinition(promptKey: string, version?: string): PromptDefinition;

  /**
   * Lists all registered prompt definitions across all versions.
   */
  listDefinitions(): PromptDefinition[];

  /**
   * Lists all registered versions for a given prompt key.
   */
  listVersions(promptKey: string): PromptDefinition[];
}

/**
 * PromptManager
 *
 * Centralized Prompt Management service coordinating prompt resolution,
 * variable validation, deterministic rendering, and boundary enforcement.
 */
export class PromptManager implements IPromptManager {
  constructor(
    private readonly registry: PromptRegistry = defaultPromptRegistry,
  ) {}

  /**
   * Builds a provider-neutral ManagedPrompt with verified system instructions,
   * bounded dynamic context, and evaluation hash.
   */
  public buildPrompt(
    promptKey: string,
    context: PromptRenderContext,
    version?: string,
  ): ManagedPrompt {
    // 1. Definition lookup
    const definition = this.registry.get(promptKey, version);
    if (!definition) {
      if (version && this.registry.listVersions(promptKey).length > 0) {
        throw new PromptException(
          "PROMPT_VERSION_NOT_FOUND",
          `Prompt definition '${promptKey}' version '${version}' not found in registry`,
          { promptKey, version },
        );
      }
      throw new PromptException(
        "PROMPT_NOT_FOUND",
        `Prompt definition '${promptKey}' not found in registry`,
        { promptKey, version },
      );
    }

    // 2. Validate context variables against definition requirements
    const contextValidation = PromptValidator.validateContext(
      definition,
      context,
    );
    if (!contextValidation.isValid) {
      throw new PromptException(
        "PROMPT_MISSING_VARIABLES",
        `Context validation failed for prompt '${promptKey}': ${contextValidation.errors.join("; ")}`,
        {
          promptKey,
          version: definition.version,
          details: contextValidation.errors,
        },
      );
    }

    // 3. Render ManagedPrompt
    const managedPrompt = PromptRenderer.render(definition, context);

    // 4. Validate rendered output (no unresolved placeholders, no sensitive data)
    const renderValidation =
      PromptValidator.validateRenderedPrompt(managedPrompt);
    if (!renderValidation.isValid) {
      const isUnresolved = renderValidation.errors.some((e) =>
        e.includes("Unresolved"),
      );
      const errorCode = isUnresolved
        ? "PROMPT_UNRESOLVED_PLACEHOLDERS"
        : "PROMPT_SENSITIVE_DATA_DETECTED";

      throw new PromptException(
        errorCode,
        `Rendered prompt validation failed for '${promptKey}': ${renderValidation.errors.join("; ")}`,
        {
          promptKey,
          version: definition.version,
          details: renderValidation.errors,
        },
      );
    }

    logger.info(
      `[PromptManager] Constructed managed prompt [key: ${promptKey}, version: ${definition.version}, operation: ${definition.operation}, hash: ${managedPrompt.metadata.hash.substring(0, 8)}]`,
    );

    return managedPrompt;
  }

  /**
   * Retrieves an approved prompt definition.
   */
  public getDefinition(promptKey: string, version?: string): PromptDefinition {
    const definition = this.registry.get(promptKey, version);
    if (!definition) {
      throw new PromptException(
        "PROMPT_NOT_FOUND",
        `Prompt definition '${promptKey}' not found`,
        { promptKey, version },
      );
    }
    return definition;
  }

  /**
   * Lists all registered prompt definitions.
   */
  public listDefinitions(): PromptDefinition[] {
    return this.registry.getAll();
  }

  /**
   * Lists all versions for a given prompt key.
   */
  public listVersions(promptKey: string): PromptDefinition[] {
    return this.registry.listVersions(promptKey);
  }
}

export const defaultPromptManager = new PromptManager();
