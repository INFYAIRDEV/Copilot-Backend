import assert from "node:assert/strict";
import {
  AIProviderStructuredRequest,
  AIProviderStructuredResponse,
  AIProviderRequest,
  AIProviderResponse,
  AIProviderException,
  ResilientAIProvider,
  IAIProvider,
  AIService,
  AIServiceException,
  OutputSchemaRegistry,
  classificationSchema,
  validateStructuredOutput,
} from "../index.js";
import { LLMProviderAdapter } from "../adapters/llm-provider.adapter.js";

class StructuredTestProvider implements IAIProvider {
  public readonly requests: AIProviderStructuredRequest[] = [];
  public readonly responses: AIProviderStructuredResponse[] = [];
  public readonly providerError?: Error;

  constructor(
    options: {
      responses?: AIProviderStructuredResponse[];
      providerError?: Error;
    } = {},
  ) {
    this.responses = options.responses || [];
    this.providerError = options.providerError;
  }

  async generateCandidatePlan(
    _request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    throw new Error("Candidate plan generation is not used in this test");
  }

  generateStructuredOutput:
    NonNullable<IAIProvider["generateStructuredOutput"]> | undefined = async (
    request: AIProviderStructuredRequest,
  ) => {
    this.requests.push(request);
    if (this.providerError) throw this.providerError;
    const response = this.responses.shift();
    if (!response) throw new Error("No structured response fixture configured");
    return response;
  };

  getProviderMetadata() {
    return {
      providerName: "TEST_PROVIDER",
      defaultModel: "test-model",
      isAvailable: true,
    };
  }
}

function providerResponse(
  content: string,
  extra: Partial<AIProviderStructuredResponse> = {},
): AIProviderStructuredResponse {
  return {
    content,
    providerName: "TEST_PROVIDER",
    modelName: "test-model",
    finishReason: "STOP",
    ...extra,
  };
}

const baseRequest = {
  prompt: "Classify the following text.",
  context: { userId: 13, roleId: "user", locale: "en" },
  schema: classificationSchema,
  correlationId: "structured-test-request",
};

async function run() {
  assert.equal(classificationSchema.id, "text_classification");
  assert.equal(classificationSchema.providerSchema.type, "object");
  assert.deepEqual(classificationSchema.providerSchema.required, [
    "category",
    "confidence",
    "summary",
  ]);
  assert.equal(classificationSchema.providerSchema.additionalProperties, false);
  assert.equal(
    classificationSchema.providerSchema.properties?.confidence.minimum,
    0,
  );
  assert.equal(
    classificationSchema.providerSchema.properties?.confidence.maximum,
    1,
  );

  const valid = {
    category: "technical",
    confidence: 0.92,
    summary: "A backend implementation request.",
  };
  const parsed = validateStructuredOutput(
    JSON.stringify(valid),
    classificationSchema.schema,
  );
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.category, "technical");

  assert.equal(
    validateStructuredOutput("", classificationSchema.schema).success,
    false,
  );
  assert.equal(
    validateStructuredOutput("{bad", classificationSchema.schema).success,
    false,
  );
  assert.equal(
    validateStructuredOutput(
      JSON.stringify({ ...valid, category: "other-ish" }),
      classificationSchema.schema,
    ).success,
    false,
  );
  assert.equal(
    validateStructuredOutput(
      JSON.stringify({ ...valid, confidence: 1.5 }),
      classificationSchema.schema,
    ).success,
    false,
  );
  assert.equal(
    validateStructuredOutput(
      JSON.stringify({ ...valid, summary: "" }),
      classificationSchema.schema,
    ).success,
    false,
  );
  assert.equal(
    validateStructuredOutput(
      JSON.stringify({ ...valid, unexpected: true }),
      classificationSchema.schema,
    ).success,
    false,
  );

  const successProvider = new StructuredTestProvider({
    responses: [providerResponse(JSON.stringify(valid))],
  });
  const success = await new AIService(successProvider).generateStructuredOutput(
    baseRequest,
  );
  assert.deepEqual(success.data, valid);
  assert.equal(success.metadata.validationStatus, "valid");
  assert.equal(success.metadata.provider, "TEST_PROVIDER");
  assert.equal(success.metadata.promptVersion, "1.0.0");
  assert.equal(
    successProvider.requests[0].structuredOutput.name,
    "TextClassification",
  );
  assert.equal(
    successProvider.requests[0].structuredOutput.schema.type,
    "object",
  );
  assert.match(
    successProvider.requests[0].prompt,
    /untrusted_text_to_classify/,
  );

  const recoveredProvider = new StructuredTestProvider({
    responses: [
      providerResponse(
        JSON.stringify({
          category: "unknown",
          confidence: 0.4,
          summary: "bad enum",
        }),
      ),
      providerResponse(JSON.stringify(valid)),
    ],
  });
  const recovered = await new AIService(
    recoveredProvider,
  ).generateStructuredOutput(baseRequest);
  assert.equal(recovered.metadata.recoveryAttempts, 1);
  assert.equal(recoveredProvider.requests.length, 2);

  const invalidProvider = new StructuredTestProvider({
    responses: [providerResponse("{}"), providerResponse("{}")],
  });
  await assert.rejects(
    () => new AIService(invalidProvider).generateStructuredOutput(baseRequest),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "AI_OUTPUT_RECOVERY_EXHAUSTED" &&
      error.statusCode === 422,
  );

  const noRecoveryProvider = new StructuredTestProvider({
    responses: [providerResponse("{}")],
  });
  const noRecoveryService = new AIService(
    noRecoveryProvider,
    undefined,
    undefined,
    undefined,
    undefined,
    new OutputSchemaRegistry(),
  );
  await assert.rejects(
    () => noRecoveryService.generateStructuredOutput(baseRequest),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "AI_OUTPUT_SCHEMA_NOT_FOUND",
  );

  const refusalProvider = new StructuredTestProvider({
    responses: [providerResponse("", { refusal: true })],
  });
  await assert.rejects(
    () => new AIService(refusalProvider).generateStructuredOutput(baseRequest),
    (error: unknown) =>
      error instanceof AIServiceException && error.code === "AI_OUTPUT_REFUSED",
  );

  const truncatedProvider = new StructuredTestProvider({
    responses: [providerResponse("{", { finishReason: "MAX_TOKENS" })],
  });
  await assert.rejects(
    () =>
      new AIService(truncatedProvider).generateStructuredOutput(baseRequest),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "AI_OUTPUT_INCOMPLETE",
  );

  const unsupportedProvider = new StructuredTestProvider();
  unsupportedProvider.generateStructuredOutput = undefined;
  await assert.rejects(
    () =>
      new AIService(unsupportedProvider).generateStructuredOutput(baseRequest),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "AI_STRUCTURED_OUTPUT_UNSUPPORTED" &&
      error.statusCode === 501,
  );

  const rejectedProvider = new StructuredTestProvider({
    providerError: new AIProviderException(
      "REJECTED",
      "Invalid response schema",
      "TEST_PROVIDER",
    ),
  });
  await assert.rejects(
    () => new AIService(rejectedProvider).generateStructuredOutput(baseRequest),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "AI_STRUCTURED_OUTPUT_UNSUPPORTED",
  );

  const timeoutProvider = new StructuredTestProvider({
    providerError: new AIProviderException(
      "TIMEOUT",
      "provider timeout",
      "TEST_PROVIDER",
    ),
  });
  const resilientTimeoutProvider = new ResilientAIProvider(
    timeoutProvider,
    undefined,
    undefined,
    { retryBackoffMs: 0 },
  );
  await assert.rejects(
    () =>
      new AIService(resilientTimeoutProvider).generateStructuredOutput(
        baseRequest,
      ),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "COPILOT_MODEL_TIMEOUT",
  );
  assert.equal(
    timeoutProvider.requests.length,
    2,
    "Transient provider errors use only the existing single retry",
  );

  const authFailureProvider = new StructuredTestProvider({
    providerError: new AIProviderException(
      "CONFIG_ERROR",
      "provider credentials invalid",
      "TEST_PROVIDER",
    ),
  });
  const resilientAuthProvider = new ResilientAIProvider(
    authFailureProvider,
    undefined,
    undefined,
    { retryBackoffMs: 0 },
  );
  await assert.rejects(
    () =>
      new AIService(resilientAuthProvider).generateStructuredOutput(
        baseRequest,
      ),
    (error: unknown) =>
      error instanceof AIServiceException &&
      error.code === "COPILOT_CONFIG_ERROR",
  );
  assert.equal(
    authFailureProvider.requests.length,
    1,
    "Non-transient configuration failures are not retried",
  );

  const previousFetch = globalThis.fetch;
  let providerRequest: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    providerRequest = { url: String(input), init };
    return new Response(
      JSON.stringify({
        modelVersion: "gemini-test-model",
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(valid) }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 8,
          totalTokenCount: 20,
        },
      }),
      {
        status: 200,
        headers: { "x-goog-request-id": "provider-request-test" },
      },
    );
  };
  try {
    const adapter = new LLMProviderAdapter({
      apiKey: "test-secret",
      environment: "development",
      modelIdentifier: "gemini-test-model",
      endpointUrl: "https://provider.test/v1beta",
      timeoutMs: 1000,
      maxOutputTokens: 128,
    });
    const providerResult = await adapter.generateStructuredOutput({
      prompt: "Classify this input",
      systemInstruction: "Classify safely.",
      structuredOutput: {
        name: "TextClassification",
        description: classificationSchema.description,
        schema: classificationSchema.providerSchema,
      },
    });
    assert.equal(providerResult.modelName, "gemini-test-model");
    assert.equal(providerResult.requestId, "provider-request-test");
    assert.equal(providerResult.usage?.totalTokens, 20);
    assert.ok(providerRequest);
    assert.ok(!providerRequest.url.includes("test-secret"));
    assert.equal(
      new Headers(providerRequest.init?.headers).get("x-goog-api-key"),
      "test-secret",
    );
    const payload = JSON.parse(String(providerRequest.init?.body)) as {
      systemInstruction?: { parts: Array<{ text: string }> };
      generationConfig?: {
        responseFormat?: {
          text?: {
            mimeType?: string;
            schema?: { type?: string; title?: string };
          };
        };
      };
    };
    assert.match(
      payload.systemInstruction?.parts[0].text || "",
      /Classify safely/,
    );
    assert.equal(
      payload.generationConfig?.responseFormat?.text?.mimeType,
      "application/json",
    );
    assert.equal(
      payload.generationConfig?.responseFormat?.text?.schema?.type,
      "object",
    );
    assert.equal(
      payload.generationConfig?.responseFormat?.text?.schema?.title,
      "TextClassification",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }

  console.log("Structured AI output checks passed.");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
