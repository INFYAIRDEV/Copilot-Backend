import { GoogleAuth } from "google-auth-library";
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
): Promise<ReadyQueryResponse | ClarificationResponse> {
  try {
    console.log("generate api reached")
    return await callAIService<ReadyQueryResponse | ClarificationResponse>(
      "/v1/query/generate",
      req,
    );
    console.log("generate api reached - resp")
  } catch (err: any) {
    logger.warn("Remote AI Query Service call failed, falling back to local engine:", err.message);
  }

  // Fallback to local SQL generator if remote service is unavailable
  return await generateValidatedSql(req);
}

/**
 * Dispatches trusted query results to Data/AI service for executive narration (POST /v1/result/interpret).
 */
export async function interpretResultFromAi(
  req: InterpretResultRequest,
): Promise<InterpretResultResponse> {
  try {
    const result = await callAIService<InterpretResultResponse>(
      "/v1/result/interpret",
      req,
    );
    console.log("result from intepretation by ai", result)
    return result;
  } catch (err: any) {
    logger.warn("Remote AI Interpretation call failed, falling back to local engine:", err.message);
  }
  // Fallback to local executive narration engine
  return await interpretTrustedResult(req);
}
