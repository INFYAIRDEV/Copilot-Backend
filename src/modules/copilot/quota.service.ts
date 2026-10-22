import { prisma } from "../../shared/utils/prismaClient.js";
import { logger } from "../../shared/utils/logger.js";

export interface QuotaCheckResult {
  allowed: boolean;
  dailyUsage: number;
  dailyLimit: number;
  tier: string;
}

const TIER_LIMITS: Record<string, number> = {
  BASIC: 20,
  PRO: 100,
  BUSINESS: 1000,
  ADMIN: 5000,
};

/**
 * Checks if the user has remaining query allowance for the day (Section 8.2 & 8.4).
 * Throws HTTP 429 USAGE_LIMIT_EXCEEDED if daily quota is reached.
 */
export async function checkUserQuota(userId: number, roleId?: string): Promise<QuotaCheckResult> {
  // Determine tier based on user role or default to PRO/BASIC
  let tier = "PRO";
  if (roleId === "1" || roleId === "admin") {
    tier = "ADMIN";
  } else if (roleId === "3" || roleId === "operator") {
    tier = "BASIC";
  }

  const dailyLimit = TIER_LIMITS[tier] || 100;

  // Count requests executed by this user today in UTC
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  try {
    const usageCount = await prisma.conversation_message.count({
      where: {
        role: "USER",
        created_at: { gte: startOfDay },
        conversation: { owner_user_id: userId },
      },
    });

    if (usageCount >= dailyLimit) {
      logger.warn("USAGE_LIMIT_REJECTED", {
        severity: "WARN",
        event: "USAGE_LIMIT_REJECTED",
        userId,
        tier,
        dailyLimit,
        usageCount,
      });

      const err: any = new Error("The current usage allowance has been reached.");
      err.statusCode = 429;
      err.code = "USAGE_LIMIT_EXCEEDED";
      err.status = "REJECTED";
      err.retryable = false;
      throw err;
    }

    return {
      allowed: true,
      dailyUsage: usageCount,
      dailyLimit,
      tier,
    };
  } catch (error: any) {
    if (error.statusCode === 429) throw error;
    logger.warn(`Could not verify usage quota for user ${userId}, permitting request`, error);
    return {
      allowed: true,
      dailyUsage: 0,
      dailyLimit,
      tier,
    };
  }
}

/**
 * Records model usage and token consumption after request completes (Section 8.2 & 9.2).
 */
export async function recordUserUsage(args: {
  userId: number;
  answerId?: number;
  requestId: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}): Promise<void> {
  try {
    if (args.answerId) {
      await prisma.model_usage.create({
        data: {
          request_uuid: args.requestId,
          answer_id: args.answerId,
          provider: "google-vertex",
          model: args.model || "gemini-1.5-flash",
          purpose: "sql-generation",
          input_tokens: args.inputTokens || 500,
          output_tokens: args.outputTokens || 200,
          latency_ms: args.durationMs || 0,
          status: "SUCCESS",
        },
      });

    }

    logger.info("USAGE_RECORDED", {
      event: "REQUEST_COMPLETED",
      userId: args.userId,
      requestId: args.requestId,
      durationMs: args.durationMs,
      tokens: (args.inputTokens || 500) + (args.outputTokens || 200),
    });
  } catch (err) {
    logger.warn("Failed to record model usage metrics:", err);
  }
}
