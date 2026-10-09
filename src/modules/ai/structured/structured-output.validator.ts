import { z } from "zod";
import {
  StructuredParseResult,
  StructuredValidationIssue,
} from "./structured-output.types.js";

export function validateStructuredOutput<T>(
  content: unknown,
  schema: z.ZodType<T>,
): StructuredParseResult<T> {
  if (typeof content === "string" && content.trim().length === 0) {
    return { success: false, code: "AI_OUTPUT_EMPTY", issues: [] };
  }

  let value: unknown = content;
  if (typeof content === "string") {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      return {
        success: false,
        code: "AI_OUTPUT_PARSE_FAILED",
        issues: [{ path: "$", code: "invalid_json" }],
      };
    }
  }

  const parsed = schema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data };

  const issues: StructuredValidationIssue[] = parsed.error.issues.map(
    (issue) => ({
      path: issue.path.length ? issue.path.map(String).join(".") : "$",
      code: issue.code,
    }),
  );
  return { success: false, code: "AI_OUTPUT_VALIDATION_FAILED", issues };
}
