import { Router, Request, Response } from "express";
import { generateValidatedSql, interpretTrustedResult } from "./ai-query.service.js";
import { logger } from "../../shared/utils/logger.js";

const router = Router();

/**
 * POST /v1/query/generate
 * Generates and hardens SQL from question + conversation context (Section 6.2).
 */
router.post("/query/generate", async (req: Request, res: Response) => {
  const { requestId, conversationId, userId, aiSessionId, question, locale, conversationContext } = req.body;

  if (!question || typeof question !== "string") {
    return res.status(400).json({
      requestId: requestId || "req-unknown",
      status: "INVALID_REQUEST",
      code: "INVALID_REQUEST",
      message: "Question is required.",
    });
  }

  try {
    const result = await generateValidatedSql({
      requestId: requestId || `req-${Date.now()}`,
      conversationId: conversationId || `conv-${Date.now()}`,
      userId: userId || "user-default",
      aiSessionId: aiSessionId || null,
      question,
      locale,
      conversationContext,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error("Error in /v1/query/generate:", err);
    return res.status(err.statusCode || 422).json({
      requestId: requestId || "req-unknown",
      status: "FAILED",
      code: err.code || "SAFE_QUERY_GENERATION_FAILED",
      message: err.message || "A safe query could not be generated for this request.",
      attemptCount: err.attemptCount || 3,
      retryable: err.retryable || false,
    });
  }
});

/**
 * POST /v1/result/interpret
 * Summarizes bounded trusted DB result and recommends visualization (Section 6.4).
 */
router.post("/result/interpret", async (req: Request, res: Response) => {
  const { requestId, conversationId, userId, aiSessionId, question, result, executionMetadata } = req.body;

  if (!result || !result.rows) {
    return res.status(400).json({
      requestId: requestId || "req-unknown",
      status: "INVALID_REQUEST",
      code: "INVALID_REQUEST",
      message: "Result payload with rows is required.",
    });
  }

  try {
    const response = await interpretTrustedResult({
      requestId: requestId || `req-${Date.now()}`,
      conversationId: conversationId || `conv-${Date.now()}`,
      userId: userId || "user-default",
      aiSessionId: aiSessionId || `session-${Date.now()}`,
      question: question || "Sales Query Result",
      result,
      executionMetadata: executionMetadata || { durationMs: 0 },
    });

    return res.status(200).json(response);
  } catch (err: any) {
    logger.error("Error in /v1/result/interpret:", err);
    return res.status(err.statusCode || 500).json({
      requestId: requestId || "req-unknown",
      status: "FAILED",
      code: err.code || "INTERPRETATION_FAILED",
      message: err.message || "Failed to interpret query result.",
    });
  }
});

export default router;
