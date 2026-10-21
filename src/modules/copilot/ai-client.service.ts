import {
  generateValidatedSql,
  interpretTrustedResult,
  GenerateQueryRequest,
  ReadyQueryResponse,
  ClarificationResponse,
  InterpretResultRequest,
  InterpretResultResponse,
} from "./ai-query.service.js";
import { logger } from "../../shared/utils/logger.js";

const AI_QUERY_SERVICE_URL = process.env.AI_QUERY_SERVICE_URL;

/**
 * Dispatches query generation to the Data/AI service (Section 6.2).
 * Calls external Cloud Run service if AI_QUERY_SERVICE_URL is set,
 * otherwise invokes the local validated query generator.
 */
export async function generateQueryFromAi(
  req: GenerateQueryRequest,
): Promise<ReadyQueryResponse | ClarificationResponse> {
  if (AI_QUERY_SERVICE_URL) {
    try {
      const response = await fetch(`${AI_QUERY_SERVICE_URL}/v1/query/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.AI_SERVICE_AUTH_TOKEN
            ? { Authorization: `Bearer ${process.env.AI_SERVICE_AUTH_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(req),
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        const err: any = new Error(errorData.message || "AI Query Service generation failed.");
        err.statusCode = response.status;
        err.code = errorData.code || "AI_QUERY_SERVICE_ERROR";
        throw err;
      }

      return (await response.json()) as ReadyQueryResponse | ClarificationResponse;
    } catch (err: any) {
      logger.warn("Remote AI Query Service call failed, falling back to local engine:", err.message);
    }
  }

  // Fallback / local execution
  return await generateValidatedSql(req);
}

/**
 * Dispatches trusted query results to Data/AI service for executive narration (Section 6.4).
 */
export async function interpretResultFromAi(
  req: InterpretResultRequest,
): Promise<InterpretResultResponse> {
  if (AI_QUERY_SERVICE_URL) {
    try {
      const response = await fetch(`${AI_QUERY_SERVICE_URL}/v1/result/interpret`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.AI_SERVICE_AUTH_TOKEN
            ? { Authorization: `Bearer ${process.env.AI_SERVICE_AUTH_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(req),
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        const err: any = new Error(errorData.message || "AI result interpretation failed.");
        err.statusCode = response.status;
        err.code = errorData.code || "INTERPRET_SERVICE_ERROR";
        throw err;
      }

      return (await response.json()) as InterpretResultResponse;
    } catch (err: any) {
      logger.warn("Remote AI Interpretation call failed, falling back to local engine:", err.message);
    }
  }

  // Fallback / local execution
  return await interpretTrustedResult(req);
}
