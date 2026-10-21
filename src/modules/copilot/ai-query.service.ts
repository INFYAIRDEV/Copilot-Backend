import { getSchemaCatalogPrompt } from "./schema-catalog.js";
import { validateAndHardenSql, ensureQueryLimit, SqlValidationResult } from "./sql-hardener.js";
import { logger } from "../../shared/utils/logger.js";

export interface GenerateQueryRequest {
  requestId: string;
  conversationId: string;
  userId: string;
  aiSessionId: string | null;
  question: string;
  locale?: string;
  conversationContext?: {
    previousQuestion?: string | null;
    previousResolvedContext?: string | null;
  };
}

export interface ReadyQueryResponse {
  requestId: string;
  conversationId: string;
  aiSessionId: string;
  status: "READY";
  sql: string;
  referencedTables: string[];
  referencedColumns: string[];
  clarificationQuestion?: null;
  reasoningSummary?: string;
  attemptCount: number;
  code?: string | null;
  retryable?: boolean | null;
  queryType?: "SELECT";
  validation?: { passed: boolean };
  visualizationHint?: {
    type?: "bar" | "line" | "scatter" | "table";
    title?: string;
    x?: string;
    y?: string;
  };
}

export interface ClarificationResponse {
  requestId: string;
  conversationId: string;
  aiSessionId: string;
  status: "NEEDS_CLARIFICATION";
  sql?: null;
  clarificationQuestion: string;
  question?: string;
  attemptCount: number;
}

export interface MatrixResultPayload {
  columns: string[];
  rows: any[][];
  rowCount: number;
  truncated: boolean;
}

export interface InterpretResultRequest {
  requestId: string;
  conversationId: string;
  userId: string;
  aiSessionId: string;
  question: string;
  result: MatrixResultPayload | {
    columns: Array<{ name: string; type: string }> | string[];
    rows: any[];
    rowCount: number;
    truncated: boolean;
  };
  executionMetadata?: {
    durationMs: number;
  };
}

export interface InterpretResultResponse {
  requestId: string;
  conversationId: string;
  aiSessionId: string;
  status: "READY" | "SUCCESS";
  answer: string;
  summary?: string;
  chart?: {
    type: "bar" | "line" | "scatter" | "table" | string;
    title: string;
    x?: string;
    y?: string;
    data?: any[];
  };
  visualization?: any;
  resultTruncated?: boolean;
  rowsReceived?: number;
  rowsSentToModel?: number;
  code?: string | null;
}

/**
 * Calls Google Gemini / Vertex AI REST API using fetch.
 */
async function callGeminiApi(prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = process.env.AI_PROVIDER_API_KEY || process.env.GEMINI_API_KEY;
  const endpoint = process.env.AI_PROVIDER_ENDPOINT_URL || "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.AI_PROVIDER_MODEL_IDENTIFIER || "gemini-3.8-flash";

  if (!apiKey) {
    const err: any = new Error("AI provider API key is not configured.");
    err.statusCode = 500;
    err.code = "AI_CONFIGURATION_ERROR";
    throw err;
  }

  const url = `${endpoint}/models/${model}:generateContent?key=${apiKey}`;

  const body: any = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Gemini API returned ${response.status}: ${errorText}`);
    const err: any = new Error(`AI model provider error (${response.status}): ${errorText}`);
    err.statusCode = 502;
    err.code = "MODEL_PROVIDER_ERROR";
    throw err;
  }

  const data: any = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    const err: any = new Error("No text candidate returned from Gemini API");
    err.statusCode = 502;
    err.code = "MODEL_PROVIDER_EMPTY_RESPONSE";
    throw err;
  }

  return text;
}

/**
 * Service function: Generates validated SQL with AST hardening and repair loop (Section 5 & 5.5).
 */
export async function generateValidatedSql(
  req: GenerateQueryRequest,
): Promise<ReadyQueryResponse | ClarificationResponse> {
  const schemaContext = getSchemaCatalogPrompt();
  const maxAttempts = 3; // initial + 2 repairs

  let repairFeedback = "";
  let lastErrorReason = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isRepair = attempt > 1;

    let userPrompt = `
User Question: "${req.question}"
Locale: ${req.locale || "en"}
${req.conversationContext?.previousQuestion ? `Previous Question: "${req.conversationContext.previousQuestion}"` : ""}
${req.conversationContext?.previousResolvedContext ? `Previous Conversation Context:\n${req.conversationContext.previousResolvedContext}` : ""}

${schemaContext}

Instructions:
1. Generate a single PostgreSQL SELECT or WITH ... SELECT statement answering the question.
2. Only reference approved reporting.* views and columns defined above.
3. If the question is ambiguous and cannot be resolved safely, return status: "NEEDS_CLARIFICATION" with a clarifying question.
4. If the user question is a follow-up or refinement referring to the previous question or conversation context (e.g. "now break it down by product", "filter to Canada", "what about 2014?", "show only top 5"):
   - Preserve the active filters, entities, aggregations, and date ranges from the previous query unless the user explicitly asks to replace them.
   - Adapt the SQL query to incorporate the new constraints while retaining relevant prior context.
5. Return strict JSON format with fields:
   - status: "READY" | "NEEDS_CLARIFICATION"
   - sql: (valid PostgreSQL SELECT query)
   - intent: (e.g. "RANK", "TREND", "COMPARISON", "AGGREGATE")
   - title: (short chart/table title)
   - visualizationHint: { "type": "bar" | "line" | "scatter" | "table", "x": string, "y": string }
`;

    if (isRepair) {
      userPrompt += `\nCRITICAL: Previous candidate failed validation: "${lastErrorReason}". Please repair the query. Make sure it is SELECT only, references only reporting.* views, and contains valid syntax.`;
    }

    try {
      const modelRaw = await callGeminiApi(
        userPrompt,
        "You are a PostgreSQL sales intelligence analytics expert. Always generate valid PostgreSQL SELECT queries against reporting views. When the user asks a follow-up question, preserve prior context and filters from the previous query."
      );

      // Clean JSON delimiters if returned
      const cleanJson = modelRaw.replace(/^```json/m, "").replace(/^```/m, "").trim();
      const parsed = JSON.parse(cleanJson);
      const aiSessionId =
        req.aiSessionId ||
        String(BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000)));

      if (parsed.status === "NEEDS_CLARIFICATION") {
        const clarificationQuestion =
          parsed.clarificationQuestion ||
          parsed.question ||
          "What would you like to rank: customers, products, salespeople, or territories?";
        return {
          requestId: req.requestId,
          conversationId: req.conversationId,
          aiSessionId,
          status: "NEEDS_CLARIFICATION",
          sql: null,
          clarificationQuestion,
          question: clarificationQuestion,
          attemptCount: attempt,
        };
      }

      const candidateSql = parsed.sql;
      if (!candidateSql) {
        lastErrorReason = "No SQL statement found in model output.";
        continue;
      }

      // Run full deterministic AST and structural hardening
      const validation = validateAndHardenSql(candidateSql);

      if (validation.passed) {
        const finalSql = ensureQueryLimit(candidateSql, 1000);
        return {
          requestId: req.requestId,
          conversationId: req.conversationId,
          aiSessionId,
          status: "READY",
          attemptCount: attempt,
          sql: finalSql,
          queryType: "SELECT",
          referencedTables: validation.referencedTables,
          referencedColumns: validation.referencedColumns,
          clarificationQuestion: null,
          reasoningSummary: parsed.reasoningSummary || parsed.title || "Aggregated query results.",
          validation: { passed: true },
          visualizationHint: parsed.visualizationHint || { type: "table" },
          code: null,
          retryable: null,
        };
      } else {
        lastErrorReason = validation.reason || "Validation failed";
        logger.warn(`Candidate ${attempt} failed validation: ${lastErrorReason}`);
      }
    } catch (err: any) {
      lastErrorReason = err.message || "Failed to parse model output";
      logger.warn(`Model generation attempt ${attempt} failed: ${lastErrorReason}`);
    }
  }

  // All 3 attempts exhausted: Fail closed (HTTP 422 SAFE_QUERY_GENERATION_FAILED)
  const err: any = new Error("A safe query could not be generated for this request.");
  err.statusCode = 422;
  err.code = "SAFE_QUERY_GENERATION_FAILED";
  err.attemptCount = maxAttempts;
  err.retryable = false;
  throw err;
}

/**
 * Service function: Interprets bounded trusted query results and generates narrative summary + visualization (Section 6.4).
 */
export async function interpretTrustedResult(
  req: InterpretResultRequest,
): Promise<InterpretResultResponse> {
  const { question, result } = req;
  const durationMs = req.executionMetadata?.durationMs || 0;

  // Enforce interpretation limits (Section 7.2)
  if (result.rows.length > 200) {
    const err: any = new Error("Result row count exceeds interpretation maximum of 200 rows.");
    err.statusCode = 422;
    err.code = "RESULT_TOO_LARGE_FOR_INTERPRETATION";
    throw err;
  }

  const prompt = `
You are an executive sales analyst summarizing bounded database results for business stakeholders.
User Question: "${question}"
Query Execution Duration: ${durationMs}ms
Row Count: ${result.rowCount} (Truncated: ${result.truncated})
Columns: ${JSON.stringify(result.columns)}
Rows: ${JSON.stringify(result.rows.slice(0, 50))}

Provide an executive, factual summary of these results and recommend the best visualization (bar, line, scatter, or table).
Return strict JSON format:
{
  "status": "READY",
  "answer": "Clear, concise 1-2 sentence business insight summarizing key metrics and top performers.",
  "chart": {
    "type": "bar" | "line" | "scatter" | "table",
    "title": "Short descriptive title",
    "x": "column name for x axis",
    "y": "column name for y axis"
  }
}
`;

  try {
    const raw = await callGeminiApi(prompt);
    const cleanJson = raw.replace(/^```json/m, "").replace(/^```/m, "").trim();
    const parsed = JSON.parse(cleanJson);
    const answer = parsed.answer || parsed.summary || "Here are the analytical results for your query.";
    const chart = parsed.chart || parsed.visualization || {
      type: "table",
      title: question,
    };

    return {
      requestId: req.requestId,
      conversationId: req.conversationId,
      aiSessionId: req.aiSessionId,
      status: "READY",
      answer,
      summary: answer,
      chart,
      visualization: chart,
      resultTruncated: Boolean(result.truncated),
      rowsReceived: result.rowCount,
      rowsSentToModel: Math.min(result.rows.length, 50),
      code: null,
    };
  } catch (err) {
    logger.error("Failed to interpret result with Gemini, using database result summary", err);
    const fallbackAnswer = `Found ${result.rowCount} record${result.rowCount === 1 ? "" : "s"} matching "${question}".`;
    const fallbackChart = {
      type: "table",
      title: question,
    };
    return {
      requestId: req.requestId,
      conversationId: req.conversationId,
      aiSessionId: req.aiSessionId,
      status: "READY",
      answer: fallbackAnswer,
      summary: fallbackAnswer,
      chart: fallbackChart,
      visualization: fallbackChart,
      resultTruncated: Boolean(result.truncated),
      rowsReceived: result.rowCount,
      rowsSentToModel: Math.min(result.rows.length, 50),
      code: null,
    };
  }
}

export const aiQueryService = {
  generateValidatedSql,
  interpretTrustedResult,
};
