import { prisma } from "../../shared/utils/prismaClient.js";
import { logger } from "../../shared/utils/logger.js";

export interface TokenUsage {
  modelCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

export interface UserUsageSummary {
  limit: number;
  used: number;
  remaining: number;
  percentUsed: number;
  resetAt: string;
}

let tableInitialized = false;

/**
 * Ensures the public.ai_token_usage table and indices exist in the database.
 */
export async function initAiUsageTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.ai_token_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        request_id VARCHAR(255) NOT NULL,
        endpoint VARCHAR(100) NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thought_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_ai_token_usage_request_endpoint UNIQUE (request_id, endpoint)
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_created 
      ON public.ai_token_usage (user_id, created_at);
    `);
    tableInitialized = true;
  } catch (err: any) {
    logger.warn(`Could not verify or create ai_token_usage table: ${err.message}`);
  }
}

/**
 * Returns the configured monthly token allowance.
 * Configurable via COPILOT_MONTHLY_TOKEN_LIMIT environment variable (default: 1,000,000).
 */
export function getMonthlyTokenLimit(roleId?: string | number): number {
  if (process.env.COPILOT_MONTHLY_TOKEN_LIMIT) {
    const custom = parseInt(process.env.COPILOT_MONTHLY_TOKEN_LIMIT, 10);
    if (!isNaN(custom) && custom > 0) return custom;
  }
  // Default: 1,000,000 tokens per month
  return 1_000_000;
}

/**
 * Computes monthly token consumption for an authenticated user.
 */
export async function getUserTokenUsage(
  userId: number,
  roleId?: string | number,
): Promise<UserUsageSummary> {
  await initAiUsageTable();

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

  const limit = getMonthlyTokenLimit(roleId);

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ used_tokens: string | number }>>(
      `
      SELECT COALESCE(SUM(total_tokens), 0) AS used_tokens
      FROM public.ai_token_usage
      WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
    `,
      userId,
      startOfMonth,
      resetAt,
    );

    const used = Number(rows[0]?.used_tokens ?? 0);
    const remaining = Math.max(0, limit - used);
    const percentUsed =
      limit > 0 ? Number(Math.min(100, (used / limit) * 100).toFixed(2)) : 100;

    return {
      limit,
      used,
      remaining,
      percentUsed,
      resetAt: resetAt.toISOString(),
    };
  } catch (err: any) {
    logger.warn(`Failed to compute user token usage for user ${userId}: ${err.message}`);
    return {
      limit,
      used: 0,
      remaining: limit,
      percentUsed: 0,
      resetAt: resetAt.toISOString(),
    };
  }
}

/**
 * Verifies that the user has remaining token allowance for the current month.
 * Throws 429 USAGE_LIMIT_EXCEEDED if the quota is exhausted.
 */
export async function assertUserMonthlyQuota(
  userId: number,
  roleId?: string | number,
): Promise<UserUsageSummary> {
  const summary = await getUserTokenUsage(userId, roleId);
  if (summary.remaining <= 0 && summary.limit > 0) {
    logger.warn("MONTHLY_TOKEN_ALLOWANCE_EXHAUSTED", {
      event: "USAGE_LIMIT_REJECTED",
      userId,
      used: summary.used,
      limit: summary.limit,
      resetAt: summary.resetAt,
    });

    const err: any = new Error("Monthly AI token allowance has been exhausted.");
    err.statusCode = 429;
    err.code = "USAGE_LIMIT_EXCEEDED";
    err.status = "REJECTED";
    err.data = summary;
    throw err;
  }
  return summary;
}

/**
 * Persists token consumption for an authenticated user after an AI call.
 * Uses (request_id, endpoint) uniqueness to guarantee idempotency across retries.
 */
export async function recordAiTokenUsage(args: {
  userId: number;
  requestId: string;
  endpoint: string;
  usage?: TokenUsage | null;
}): Promise<void> {
  const { userId, requestId, endpoint, usage } = args;
  if (!usage) return;

  await initAiUsageTable();

  const inputTokens = Math.max(0, Number(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
  const thoughtTokens = Math.max(0, Number(usage.thoughtTokens ?? 0));
  const totalTokens = Math.max(
    0,
    Number(usage.totalTokens ?? inputTokens + outputTokens + thoughtTokens),
  );

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO public.ai_token_usage
        (user_id, request_id, endpoint, input_tokens, output_tokens, thought_tokens, total_tokens, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (request_id, endpoint) DO NOTHING;
    `,
      userId,
      requestId,
      endpoint,
      inputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens,
    );

    logger.info("AI_TOKEN_USAGE_RECORDED", {
      event: "AI_TOKEN_USAGE_RECORDED",
      userId,
      requestId,
      endpoint,
      totalTokens,
      inputTokens,
      outputTokens,
      thoughtTokens,
    });
  } catch (err: any) {
    logger.warn(`Failed to persist AI token usage: ${err.message}`);
  }
}
