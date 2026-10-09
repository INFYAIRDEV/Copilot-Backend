import { z } from "zod";
import { AIJsonSchema } from "../types/ai-provider.types.js";

export interface OutputSchemaDefinition<T> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly promptKey: string;
  readonly schema: z.ZodType<T>;
  readonly providerSchema: AIJsonSchema;
}

export type StructuredValidationIssue = {
  path: string;
  code: string;
};

export type StructuredParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      code:
        | "AI_OUTPUT_EMPTY"
        | "AI_OUTPUT_PARSE_FAILED"
        | "AI_OUTPUT_VALIDATION_FAILED";
      issues: StructuredValidationIssue[];
    };

export type StructuredOutputResult<T> = {
  success: true;
  data: T;
  metadata: {
    schemaId: string;
    promptVersion: string;
    provider: string;
    model?: string;
    requestId?: string;
    finishReason?: string;
    validationStatus: "valid";
    recoveryAttempts: number;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
};
