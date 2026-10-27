import { GoogleAuth } from "google-auth-library";
import {
  interpretTrustedResult,
  GenerateQueryRequest,
  ReadyQueryResponse,
  ClarificationResponse,
  FailedQueryResponse,
  InterpretResultRequest,
  InterpretResultResponse,
} from "./ai-query.service.js";
import { logger } from "../../shared/utils/logger.js";

const DEFAULT_AI_SERVICE_URL = "https://infysuite-ai-query-agent-zyt5wskpwa-oc.a.run.app";

export function getAiServiceBaseUrl(): string {
  return (
    process.env.AI_SERVICE_URL ||
    process.env.AI_QUERY_SERVICE_URL ||
    DEFAULT_AI_SERVICE_URL
  ).replace(/\/+$/, "");
}

const auth = new GoogleAuth();
let cachedIdTokenClient: any = null;

/**
 * Obtains a Google-signed OIDC ID token for Cloud Run service-to-service invocation.
 * Target audience is the Cloud Run service URL.
 */
export async function getCloudRunAuthHeaders(targetAudience: string): Promise<Record<string, string>> {

  try {
    if (!cachedIdTokenClient) {
      cachedIdTokenClient = await auth.getIdTokenClient(targetAudience);
    }
    const headers = await cachedIdTokenClient.getRequestHeaders();
    return headers;
  } catch (err: any) {
    logger.warn(`Could not obtain Google Cloud Run OIDC ID token: ${err.message}`);
    return {};
  }
}

/**
 * Universal helper for calling the Data/AI service with X-API-Key or OIDC authentication.
 */
export async function callAIService<T = any>(
  path: string,
  body: unknown,
): Promise<T> {
  const baseUrl = getAiServiceBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const apiKey = process.env.AI_SERVICE_API_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    console.log("Api Key : ", apiKey)
    headers["X-API-Key"] = apiKey;
  } else {
    const authHeaders = await getCloudRunAuthHeaders(baseUrl);
    Object.assign(headers, authHeaders);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data: any = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `AI service error ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  return data as T;
}

/**
 * Health check on Data/AI service.
 */
export async function checkAiServiceHealth(): Promise<{ ok: boolean; status?: string; error?: string }> {
  const baseUrl = getAiServiceBaseUrl();
  const apiKey = process.env.AI_SERVICE_API_KEY;
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else {
      const authHeaders = await getCloudRunAuthHeaders(baseUrl);
      Object.assign(headers, authHeaders);
    }

    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data: any = await res.json().catch(() => ({}));
    return { ok: true, status: data.status || "healthy" };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Dispatches query generation to the Data/AI service (POST /v1/query/generate).
 */
export async function generateQueryFromAi(
  req: GenerateQueryRequest,
): Promise<ReadyQueryResponse | ClarificationResponse | FailedQueryResponse> {
  const payload = {
    requestId: req.requestId,
    conversationId: req.conversationId,
    userId: `${req.userId}`,
    aiSessionId: req.aiSessionId ?? null,
    locale: req.locale === "it" ? "it" : "en",
    question: req.question,
  };

  try {
    console.log("generate api reached with locale:", payload.locale);
    const result = await callAIService<ReadyQueryResponse | ClarificationResponse | FailedQueryResponse>(
      "/v1/query/generate",
      payload,
    );
    console.log("generate api reached - resp");
    return result;
  } catch (err: any) {
    if (payload.aiSessionId && String(err.message).toLowerCase().includes("not found")) {
      logger.warn(`Remote AI session expired or not found (${payload.aiSessionId}), retrying with fresh session...`);
      try {
        const retryPayload = { ...payload, aiSessionId: null };
        const result = await callAIService<ReadyQueryResponse | ClarificationResponse | FailedQueryResponse>(
          "/v1/query/generate",
          retryPayload,
        );
        return result;
      } catch (retryErr: any) {
        logger.warn("Retry with fresh session failed:", retryErr.message);
      }
    }
    logger.error("Remote AI Query Service call failed:", err.message);
    return {
      requestId: req.requestId,
      conversationId: req.conversationId,
      aiSessionId: req.aiSessionId || "",
      status: "FAILED",
      sql: null,
      referencedTables: [],
      referencedColumns: [],
      attemptCount: 1,
    };
  }
}

/**
 * Dispatches trusted query results to Data/AI service for executive narration (POST /v1/result/interpret).
 */
export async function interpretResultFromAi(
  req: InterpretResultRequest,
): Promise<InterpretResultResponse> {
  const payload = {
    requestId: req.requestId,
    conversationId: req.conversationId,
    userId: `${req.userId}`,
    aiSessionId: req.aiSessionId ?? null,
    locale: req.locale === "it" ? "it" : "en",
    question: req.question,
    result: req.result,
    ...(req.executionMetadata ? { executionMetadata: req.executionMetadata } : {}),
  };

  try {
    console.log("interpret api reached with locale:", payload.locale);
    const result = await callAIService<InterpretResultResponse>(
      "/v1/result/interpret",
      payload,
    );
    console.log("result from intepretation by ai", result);
    return result;
  } catch (err: any) {
    if (payload.aiSessionId && String(err.message).toLowerCase().includes("not found")) {
      logger.warn(`Remote AI session expired or not found (${payload.aiSessionId}), retrying interpretation with fresh session...`);
      try {
        const retryPayload = { ...payload, aiSessionId: null };
        const result = await callAIService<InterpretResultResponse>(
          "/v1/result/interpret",
          retryPayload,
        );
        return result;
      } catch (retryErr: any) {
        logger.warn("Retry interpretation with fresh session failed:", retryErr.message);
      }
    }
    logger.warn("Remote AI Interpretation call failed, falling back to local engine:", err.message);
  }
  // Fallback to local executive narration engine
  return await interpretTrustedResult(req);
}
