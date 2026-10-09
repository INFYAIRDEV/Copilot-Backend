import { BaseAIProviderAdapter } from "./base-ai-provider.adapter.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  ModelCandidatePlan,
  AIProviderException,
  AIProviderStructuredRequest,
  AIProviderStructuredResponse,
} from "../types/ai-provider.types.js";
import {
  LLMConfigManager,
  LLMProviderConfig,
} from "@/infrastructure/ai/llm-config.js";
import { logger } from "@/shared/utils/logger.js";

interface GeminiGenerateResponse {
  modelVersion?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class LLMProviderAdapter extends BaseAIProviderAdapter {
  private readonly config: LLMProviderConfig;

  constructor(customConfig?: Partial<LLMProviderConfig>) {
    const config = {
      ...LLMConfigManager.getConfig(),
      ...customConfig,
    };

    super({
      providerName: "GENERIC_LLM_PROVIDER",
      defaultModel: config.modelIdentifier,
      region: config.region,
      isAvailable: true,
    });

    this.config = config;
  }

  public async generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    const startTime = Date.now();

    // 1. Data Minimization & Context Aggregation
    const minimizedPrompt = this.sanitizeAndMinimizeInput(request.prompt);
    const systemPrompt = this.getSystemInstruction(request.systemInstruction);

    // 2. Timeout Bounded Execution Setup
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      // 3. Provider Request Construction
      const payload = {
        model: this.config.modelIdentifier,
        contents: [
          {
            role: "user",
            parts: [
              { text: `${systemPrompt}\n\nUser Input: ${minimizedPrompt}` },
            ],
          },
        ],
        generationConfig: {
          temperature: request.temperature ?? 0.1,
          maxOutputTokens:
            request.tokenBudget?.maxOutputTokens ?? this.config.maxOutputTokens,
          responseMimeType: "application/json",
        },
      };

      let responseText: string;
      let rawStatusCode = 200;

      // Mock/Simulated network path or fetch execution
      if (
        this.config.apiKey === "mock-dev-key" ||
        this.config.environment === "test"
      ) {
        // Simulated structured JSON response for testing/development
        await new Promise((resolve) => setTimeout(resolve, 15));
        responseText = JSON.stringify({
          planId: `plan-llm-${Date.now()}`,
          candidateIntents: [
            {
              intentType: "AGGREGATION",
              primaryEntity: "sales_data",
              dimensions: ["region"],
              metrics: ["total_revenue"],
              limit: 20,
            },
          ],
          confidenceScore: 0.92,
          reasoningSummary:
            "Candidate plan generated for regional sales analysis",
          suggestedVisualization: "BAR_CHART",
          isFallback: false,
        });
      } else {
        // Production HTTP Egress Request
        const res = await fetch(
          `${this.config.endpointUrl}/models/${this.config.modelIdentifier}:generateContent?key=${this.config.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );

        rawStatusCode = res.status;
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const data: any = await res.json();
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }

      clearTimeout(timeoutId);

      // 4. Structured Output Validation & Parsing
      const candidatePlan = this.parseCandidatePlan(responseText);

      const latencyMs = Date.now() - startTime;
      const inputTokens = Math.ceil(minimizedPrompt.length / 4);
      const outputTokens = Math.ceil(responseText.length / 4);

      return {
        candidatePlan,
        narrative: candidatePlan.reasoningSummary,
        rawResponseText: responseText,
        fromFallback: false,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          latencyMs,
          providerName: this.metadata.providerName,
          modelName: this.config.modelIdentifier,
          region: this.config.region,
          estimatedCostUsd: Number(
            (inputTokens * 0.000001 + outputTokens * 0.000002).toFixed(6),
          ),
          retryCount: 0,
        },
      };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error?.name === "AbortError") {
        throw new AIProviderException(
          "TIMEOUT",
          `[${this.metadata.providerName}] Request exceeded configured timeout of ${this.config.timeoutMs}ms`,
          this.metadata.providerName,
          error,
        );
      }

      throw this.normalizeError(error);
    }
  }

  /** Calls the existing Gemini-compatible provider with native JSON Schema output. */
  public async generateStructuredOutput(
    request: AIProviderStructuredRequest,
  ): Promise<AIProviderStructuredResponse> {
    if (
      !this.config.apiKey ||
      this.config.apiKey === "mock-dev-key" ||
      this.config.environment === "test"
    ) {
      throw new AIProviderException(
        "CONFIG_ERROR",
        "A real AI provider credential is required for structured generation",
        this.metadata.providerName,
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );
    const startedAt = Date.now();
    const safePrompt = this.sanitizeAndMinimizeInput(request.prompt);
    const context = request.context;
    const contextText = context
      ? `\n<application_context>\nlocale: ${context.locale || "en"}\nrole: ${context.roleId || ""}\n</application_context>`
      : "";
    const promptText = `${contextText}\n\n<untrusted_user_input>\n${safePrompt}\n</untrusted_user_input>`;
    const systemInstruction = `${request.systemInstruction?.trim() || ""}\n\n${request.structuredOutput.description}\nReturn only data matching the supplied response schema.`;

    try {
      const response = await fetch(
        `${this.config.endpointUrl}/models/${encodeURIComponent(this.config.modelIdentifier)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: {
              responseFormat: {
                text: {
                  mimeType: "application/json",
                  schema: {
                    ...request.structuredOutput.schema,
                    title: request.structuredOutput.name,
                    description: request.structuredOutput.description,
                  },
                },
              },
              maxOutputTokens:
                request.tokenBudget?.maxOutputTokens ??
                this.config.maxOutputTokens,
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`AI provider returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as GeminiGenerateResponse;
      const candidate = data.candidates?.[0];
      const usageMetadata = data.usageMetadata;
      const inputTokens = usageMetadata?.promptTokenCount;
      const outputTokens = usageMetadata?.candidatesTokenCount;
      const totalTokens = usageMetadata?.totalTokenCount;
      const hasUsage =
        inputTokens !== undefined ||
        outputTokens !== undefined ||
        totalTokens !== undefined;

      return {
        content:
          candidate?.content?.parts?.map((part) => part.text || "").join("") ||
          "",
        providerName: this.metadata.providerName,
        modelName: data.modelVersion || this.config.modelIdentifier,
        requestId: response.headers.get("x-goog-request-id") || undefined,
        finishReason: candidate?.finishReason,
        refusal:
          Boolean(data.promptFeedback?.blockReason) ||
          candidate?.finishReason === "SAFETY",
        usage: hasUsage
          ? {
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
              ...(totalTokens !== undefined ? { totalTokens } : {}),
              latencyMs: Date.now() - startedAt,
              providerName: this.metadata.providerName,
              modelName: data.modelVersion || this.config.modelIdentifier,
            }
          : undefined,
      };
    } catch (error: unknown) {
      if (error instanceof AIProviderException) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AIProviderException(
          "TIMEOUT",
          "AI provider request timed out",
          this.metadata.providerName,
          error,
        );
      }
      throw this.normalizeError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async generateCandidatePlanStream(
    request: AIProviderRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AIProviderResponse> {
    if (signal?.aborted) {
      throw new AIProviderException(
        "TIMEOUT",
        "Stream request aborted by client",
        this.metadata.providerName,
      );
    }

    const response = await this.generateCandidatePlan(request);

    if (signal?.aborted) {
      throw new AIProviderException(
        "TIMEOUT",
        "Stream request aborted by client",
        this.metadata.providerName,
      );
    }

    const narrative =
      response.narrative ||
      response.candidatePlan.reasoningSummary ||
      "Generated candidate analytical plan.";

    const words = narrative.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (signal?.aborted) {
        throw new AIProviderException(
          "TIMEOUT",
          "Stream request aborted by client",
          this.metadata.providerName,
        );
      }
      const chunk = (i === 0 ? "" : " ") + words[i];
      onChunk(chunk);
    }

    return response;
  }

  /**
   * Data Minimization: Aggregates prompt, strips sensitive tokens/credentials/raw SQL.
   */
  private sanitizeAndMinimizeInput(prompt: string): string {
    return prompt
      .replace(/password\s*=\s*['"][^'"]+['"]/gi, "password=REDACTED")
      .replace(/api[-_]?key\s*=\s*['"][^'"]+['"]/gi, "apikey=REDACTED")
      .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer REDACTED")
      .trim();
  }

  /**
   * Constructs strict JSON system instruction forcing Candidate Plan output structure.
   */
  private getSystemInstruction(customInstruction?: string): string {
    const baseInstruction = `You are a specialized AI candidate plan generator for Copilot analytics.
Your ONLY task is to return a valid JSON object matching the Candidate Typed Analytical Plan schema.
You MUST NOT output raw SQL queries, database credentials, or operational execution instructions.
JSON Schema format required:
{
  "planId": "string",
  "candidateIntents": [
    {
      "intentType": "AGGREGATION|FILTER|TREND|COMPARISON|UNKNOWN",
      "primaryEntity": "string",
      "dimensions": ["string"],
      "metrics": ["string"]
    }
  ],
  "confidenceScore": number,
  "reasoningSummary": "string",
  "suggestedVisualization": "TABLE|BAR_CHART|LINE_CHART|KPI_CARD|PIE_CHART",
  "isFallback": false
}`;

    return customInstruction
      ? `${baseInstruction}\n\nAdditional Guidance: ${customInstruction}`
      : baseInstruction;
  }

  /**
   * Parses and validates structured candidate plan output.
   * Throws AIProviderException("INVALID_RESPONSE") on malformed output.
   */
  private parseCandidatePlan(responseText: string): ModelCandidatePlan {
    try {
      // Remove any markdown code block fences if present
      const jsonText = responseText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(jsonText);

      if (!parsed || typeof parsed !== "object") {
        throw new Error("Response is not a valid JSON object");
      }

      if (!parsed.planId || !Array.isArray(parsed.candidateIntents)) {
        throw new Error(
          "Missing required candidate plan fields (planId or candidateIntents)",
        );
      }

      return {
        planId: String(parsed.planId),
        candidateIntents: parsed.candidateIntents.map((intent: any) => ({
          intentType: intent.intentType || "UNKNOWN",
          primaryEntity: String(intent.primaryEntity || "unknown_entity"),
          dimensions: Array.isArray(intent.dimensions) ? intent.dimensions : [],
          metrics: Array.isArray(intent.metrics) ? intent.metrics : [],
          filters: Array.isArray(intent.filters) ? intent.filters : undefined,
          limit: typeof intent.limit === "number" ? intent.limit : undefined,
        })),
        confidenceScore:
          typeof parsed.confidenceScore === "number"
            ? parsed.confidenceScore
            : 0.8,
        reasoningSummary: parsed.reasoningSummary || "Generated candidate plan",
        suggestedVisualization: parsed.suggestedVisualization || "TABLE",
        isFallback: false,
      };
    } catch (parseError: any) {
      logger.error(
        `[${this.metadata.providerName}] Failed to parse structured LLM response: ${parseError.message}`,
      );
      throw new AIProviderException(
        "INVALID_RESPONSE",
        `[${this.metadata.providerName}] Model output failed candidate plan validation: ${parseError.message}`,
        this.metadata.providerName,
        parseError,
      );
    }
  }
}
