import "../src/shared/translation/i18n.js";
import assert from "node:assert";
import { errorHandler, asyncHandler } from "../src/shared/middlewares/errorHandler.js";
import { ApiResponse } from "../src/shared/types/response.js";
import { UnauthorizedError, NotFoundError, ConflictError } from "../src/shared/errors/error.js";
import { languageMiddleware } from "../src/shared/middlewares/language.js";

async function runMiddlewaresTests() {
  console.log("==================================================");
  console.log(" FEATURE: SHARED MIDDLEWARES & ERROR HANDLING     ");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✔ [PASS] ${name}`);
    } catch (err: any) {
      console.error(`✘ [FAIL] ${name}`);
      console.error(err);
      throw err;
    }
  }

  // Helper mock Response
  function createMockResponse() {
    const res: any = {
      statusCode: 200,
      headersSent: false,
      payload: null,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      getHeader(k: string) {
        return this.headers[k.toLowerCase()];
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.payload = data;
        return this;
      },
    };
    return res;
  }

  // 1. Error Handler with Known Application Errors
  await test("ErrorHandler: Converts UnauthorizedError to HTTP 401 with structured envelope", () => {
    const res = createMockResponse();
    let nextCalled = false;
    const err = new UnauthorizedError("user.unauthorized");

    errorHandler(err, {} as any, res, (() => { nextCalled = true; }) as any);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.payload.success, false);
    assert.strictEqual(nextCalled, false);
  });

  await test("ErrorHandler: Converts NotFoundError to HTTP 404", () => {
    const res = createMockResponse();
    const err = new NotFoundError("user.notFound");

    errorHandler(err, {} as any, res, (() => {}) as any);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.payload.success, false);
  });

  await test("ErrorHandler: Maps unknown system error to HTTP 500 without leaking stack", () => {
    const res = createMockResponse();
    const unknownErr = new Error("Database disk corruption!");

    errorHandler(unknownErr, {} as any, res, (() => {}) as any);

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.payload.success, false);
    assert.ok(!JSON.stringify(res.payload).includes("Database disk corruption!"));
  });

  // 2. ApiResponse success envelope
  await test("ApiResponse: Standardizes success envelope with status, message and data", () => {
    const res = createMockResponse();
    ApiResponse.success(res, {
      message: "Operation completed",
      data: { id: 101, title: "Test" },
      statusCode: 200,
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.payload.success, true);
    assert.strictEqual(res.payload.data.id, 101);
  });

  // 3. AsyncHandler wrapper catches rejections
  await test("AsyncHandler: Forwards rejected promises to next()", async () => {
    let forwardedError: any = null;
    const req = {} as any;
    const res = createMockResponse();
    const next = (err: any) => { forwardedError = err; };

    const failingHandler = asyncHandler(async () => {
      throw new Error("Async failure");
    });

    await failingHandler(req, res, next);
    assert.ok(forwardedError !== null);
    assert.strictEqual(forwardedError.message, "Async failure");
  });

  // 4. Language Middleware
  await test("Language Middleware: Detects and assigns supported accept-language header", () => {
    const reqIt: any = { headers: { "accept-language": "it-IT,it;q=0.9" } };
    let nextCalled = false;
    languageMiddleware(reqIt, {} as any, () => { nextCalled = true; });
    assert.strictEqual(reqIt.lang, "it");
    assert.strictEqual(nextCalled, true);

    const reqEn: any = { headers: { "accept-language": "en-US,en;q=0.8" } };
    languageMiddleware(reqEn, {} as any, () => {});
    assert.strictEqual(reqEn.lang, "en");
  });

  console.log("==================================================");
  console.log(` SHARED MIDDLEWARES TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runMiddlewaresTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
