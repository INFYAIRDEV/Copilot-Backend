# Backend Boilerplate

A production-ready TypeScript Express backend boilerplate with Prisma, Zod validation, and modular architecture.

## 🚀 Features

- ✅ TypeScript
- ✅ Express.js
- ✅ Prisma ORM with PostgreSQL
- ✅ Zod validation
- ✅ JWT Authentication
- ✅ Modular architecture
- ✅ Error handling
- ✅ Request logging
- ✅ Rate limiting
- ✅ Docker support
- ✅ Cron jobs
- ✅ WebSocket ready
- ✅ Schema-constrained AI output with local Zod validation

## Structured AI Output

The AI module supports structured responses through the existing provider adapter and service. The built-in `text_classification` output is registered in `src/modules/ai/structured/output-schema.catalog.ts`; it uses an inferred Zod type and is emitted as a provider-compatible Gemini JSON Schema. `AIService.generateStructuredOutput` checks that the schema is registered, sends the schema to the provider's native JSON output mode, parses the response, and returns data only after Zod validation succeeds. Existing free-form and candidate-plan operations are unchanged.

```ts
import {
  AIService,
  LLMProviderAdapter,
  classificationSchema,
} from "@/modules/ai/index.js";

const ai = new AIService(new LLMProviderAdapter());
const result = await ai.generateStructuredOutput({
  prompt: "Classify the user request: ...",
  schema: classificationSchema,
  context: { userId: 123, roleId: "analyst", locale: "en" },
});
// result.data is inferred from the registered Zod schema and was locally validated.
```

The schema identifier is registered alongside the trusted `TEXT_CLASSIFICATION` prompt definition in the existing prompt catalog; callers cannot provide or override system instructions. Malformed output is not coerced or returned. One format-recovery generation is enabled by default; set `AI_STRUCTURED_OUTPUT_RECOVERY_ATTEMPTS` to `0`, `1`, or `2` to tune it. Transport retries remain governed by the existing provider resilience layer. Provider usage is tracked only when token counts are actually returned. Unsupported Zod constructs are rejected during schema definition instead of being silently weakened for provider-side enforcement.

Structured generation uses the configured Gemini-compatible `AI_PROVIDER_ENDPOINT_URL`, `AI_PROVIDER_MODEL_IDENTIFIER`, and `AI_PROVIDER_API_KEY` settings. The configured model must support Gemini JSON structured output; provider schema errors are returned as a controlled unsupported-mode error. Gemini supports a subset of JSON Schema, so local Zod validation remains authoritative. Run the focused checks with `npx tsx src/modules/ai/__tests__/structured-output.test.ts`. No new environment credential is introduced. No database schema or migrations are required.

## 📦 Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Update .env with your values

# Setup database
npx prisma migrate dev
npx prisma generate

# Run development server
npm run dev
```
