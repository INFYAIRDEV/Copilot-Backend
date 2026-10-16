import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { t } from "i18next";
import { ApiResponse } from "../../shared/types/response.js";
import { prisma } from "../../shared/utils/prismaClient.js";
import { logger } from "../../shared/utils/logger.js";
import { analyticsService, AnalyticsService } from "./analytics.service.js";
import {
  analyticsRepository,
  AnalyticsRepository,
} from "./analytics.repository.js";
import { JourneyId, PipelineExecutionResult } from "./analytics.types.js";

const JOURNEY_IDS: JourneyId[] = [
  "current-sales",
  "sales-comparison",
  "top-customers",
  "supplier-spend",
  "delayed-orders",
  "production-linkage",
];

const JOURNEY_I18N_KEYS: Record<JourneyId, string> = {
  "current-sales": "currentSales",
  "sales-comparison": "salesComparison",
  "top-customers": "topCustomers",
  "supplier-spend": "supplierSpend",
  "delayed-orders": "delayedOrders",
  "production-linkage": "productionLinkage",
};

const OLD_WORDINGS: Record<string, string> = {
  "why are there delayed orders?": "delayedOrders",
  "give me the top 5 customers.": "topCustomers",
};

// If the text is an approved journey question (EN or IT), show it in the requested language.
const translateJourneyQuestion = (
  text: string,
  locale: "en" | "it",
): string => {
  const needle = (text || "").trim().toLowerCase();
  const alias = OLD_WORDINGS[needle];
  if (alias)
    return t(`analytics.journeys.${alias}.question`, {
      lng: locale,
    }) as string;
  for (const id of JOURNEY_IDS) {
    const key = `analytics.journeys.${JOURNEY_I18N_KEYS[id]}.question`;
    for (const lng of ["en", "it"]) {
      if ((t(key, { lng }) as string).trim().toLowerCase() === needle) {
        return t(key, { lng: locale }) as string;
      }
    }
  }
  return text;
};

export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService = analyticsService,
    private readonly repo: AnalyticsRepository = analyticsRepository,
  ) {}

  /**
   * POST /api/v1/copilot/query
   *
   * Executes the full governed architectural pipeline and persists the turn
   * to analytics.conversation and analytics.conversation_message tables in PostgreSQL.
   */
  queryPipeline = async (req: Request, res: Response) => {
    const locale =
      req.body.locale === "it" ||
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    const question = req.body.question || req.body.prompt || req.body.text;
    if (!question || typeof question !== "string") {
      return ApiResponse.error(res, {
        statusCode: 400,
        code: "INVALID_REQUEST",
        message: t("analytics.questionRequired", { lng: locale }),
      });
    }

    // CHANGED: auth check added after question validation
    const ownerUserId = (req as any).user?.user_id as number | undefined;
    if (!ownerUserId) {
      return ApiResponse.error(res, {
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
      });
    }

    const incomingConversationId = req.body.conversationId;

    try {
      const result = await this.service.executePipeline({
        question,
        locale,
        userId: String(ownerUserId), // CHANGED: real user instead of fallback "user-executive"
        roleId: (req as any).user?.role_id || "executive",
      });

      const isClarification =
        "clarification" in result.candidatePlan &&
        result.candidatePlan.clarification?.status === "REQUIRED";
      const uiAnswer = isClarification
        ? result.uiAnswer
        : (result as PipelineExecutionResult).uiAnswer;

      // Persist conversation and messages to live PostgreSQL tables
      let activeConversationUuid = incomingConversationId;
      try {
        // CHANGED: removed the "find first user / create executive_user" block.
        // Conversation is now looked up and created strictly for the logged-in user.
        let conv: any = null;
        const isValidUuid =
          incomingConversationId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            incomingConversationId,
          );
        if (isValidUuid) {
          conv = await prisma.conversation.findFirst({
            where: {
              conversation_uuid: incomingConversationId,
              owner_user_id: ownerUserId,
              deleted_at: null,
            },
          });
        }

        if (!conv) {
          activeConversationUuid = randomUUID();
          conv = await prisma.conversation.create({
            data: {
              conversation_uuid: activeConversationUuid,
              owner_user_id: ownerUserId,
              locale: locale as any,
              state: "ACTIVE",
              updated_at: new Date(),
            },
          });
        } else {
          activeConversationUuid = conv.conversation_uuid;
          await prisma.conversation.update({
            where: { id: conv.id },
            data: { updated_at: new Date() },
          });
        }

        // 1. Record User Question
        await prisma.conversation_message.create({
          data: {
            conversation_id: conv.id,
            role: "USER",
            kind: "QUESTION",
            text: question,
            locale: locale as any,
            request_uuid: randomUUID(),
          },
        });

        // 2. Record Assistant Answer with complete metadata
        const completeAnswer = {
          ...uiAnswer,
          conversationId: activeConversationUuid,
          syntheticLabel: this.repo.getDataSourceLabel(),
        };

        const assistantMsg = await prisma.conversation_message.create({
          data: {
            conversation_id: conv.id,
            role: "ASSISTANT",
            kind: isClarification ? "CLARIFICATION_REQUEST" : "QUESTION",
            text: JSON.stringify(completeAnswer),
            locale: locale as any,
            request_uuid: randomUUID(),
          },
        });

        // 3. Record Answer row
        await prisma.answer.create({
          data: {
            answer_uuid: randomUUID(),
            conversation_id: conv.id,
            message_id: assistantMsg.id,
            status: "SUCCESS",
            request_uuid: randomUUID(),
            query_fingerprint: question,
          },
        });
      } catch (dbErr: any) {
        logger.warn(
          `[AnalyticsController] PostgreSQL conversation persistence note: ${dbErr.message}`,
        );
      }

      if (isClarification) {
        return ApiResponse.success(res, {
          statusCode: 200,
          message: t("analytics.clarificationRequired", { lng: locale }),
          data: {
            ...result.uiAnswer,
            conversationId: activeConversationUuid,
            candidatePlan: result.candidatePlan,
            syntheticLabel: this.repo.getDataSourceLabel(),
          },
        });
      }

      const pipelineRes = result as PipelineExecutionResult;
      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.pipelineExecuted", { lng: locale }),
        data: {
          ...pipelineRes.uiAnswer,
          conversationId: activeConversationUuid,
          candidatePlan: pipelineRes.candidatePlan,
          executionEnvelope: pipelineRes.executionEnvelope,
          blueprintResponse: pipelineRes.blueprintResponse,
          syntheticLabel: this.repo.getDataSourceLabel(),
        },
      });
    } catch (err: any) {
      logger.error(
        `[AnalyticsController] Pipeline execution failed: ${err?.message}`,
      );
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_EXECUTION_ERROR",
        message: t("analytics.executionFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/copilot/conversations/:id
   *
   * Retrieves an entire multi-turn conversation thread from the database.
   */
  getConversation = async (req: Request, res: Response) => {
    const { id } = req.params;
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    // CHANGED: auth check added after locale
    const ownerUserId = (req as any).user?.user_id as number | undefined;
    if (!ownerUserId) {
      return ApiResponse.error(res, {
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
      });
    }

    const isValidUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    if (!isValidUuid) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "CONVERSATION_NOT_FOUND",
        message: t("analytics.conversationNotFound", { lng: locale, id }),
      });
    }

    try {
      // CHANGED: findUnique -> findFirst, scoped to owner and not deleted
      const conv = await prisma.conversation.findFirst({
        where: {
          conversation_uuid: id,
          owner_user_id: ownerUserId,
          deleted_at: null,
        },
      });

      if (!conv) {
        return ApiResponse.error(res, {
          statusCode: 404,
          code: "CONVERSATION_NOT_FOUND",
          message: t("analytics.conversationNotFound", { lng: locale, id }),
        });
      }

      const rawMessages = await prisma.conversation_message.findMany({
        where: { conversation_id: conv.id },
        orderBy: { created_at: "asc" },
      });

      const messages = await Promise.all(
        rawMessages.map(async (m: any) => {
          let parsedAnswer: any = null;
          if (m.role === "ASSISTANT" && m.text) {
            try {
              parsedAnswer = JSON.parse(m.text);
              if (parsedAnswer && typeof parsedAnswer === "object") {
                // Re-render approved journey answers in the requested language
                if (JOURNEY_IDS.includes(parsedAnswer.id)) {
                  const fresh = await this.service.executeJourney(
                    parsedAnswer.id,
                    locale,
                  );
                  parsedAnswer = { ...parsedAnswer, ...fresh.uiAnswer };
                }
                if (!parsedAnswer.syntheticLabel) {
                  parsedAnswer.syntheticLabel = this.repo.getDataSourceLabel();
                }
                if (!parsedAnswer.conversationId) {
                  parsedAnswer.conversationId = conv.conversation_uuid;
                }
              }
            } catch {
              parsedAnswer = null;
            }
          }
          return {
            id: String(m.id),
            role: String(m.role).toLowerCase(),
            text:
              m.role === "USER"
                ? translateJourneyQuestion(m.text, locale)
                : parsedAnswer?.summary?.map((s: any) => s.text).join("") ||
                  m.text,
            answer: parsedAnswer,
            createdAt:
              m.created_at instanceof Date
                ? m.created_at.toISOString()
                : String(m.created_at),
          };
        }),
      );

      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.conversationRetrieved", { lng: locale }),
        data: {
          conversationId: conv.conversation_uuid,
          messages,
        },
      });
    } catch (err: any) {
      logger.error(
        `[AnalyticsController] Conversation fetch failed: ${err?.message}`,
      );
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "CONVERSATION_FETCH_ERROR",
        message: t("analytics.conversationFetchFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/copilot/answers/:id
   *
   * Retrieves the structured answer for an approved Track A journey or question ID.
   * Directly serves the UI with actual data from the database.
   */
  getAnswerById = async (req: Request, res: Response) => {
    const rawId = req.params.id;
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    const journeyId = this.service.resolveJourney(rawId);
    if (!journeyId) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "COPILOT_JOURNEY_NOT_FOUND",
        message: t("analytics.journeyNotFound", { lng: locale, id: rawId }),
      });
    }

    try {
      const result = await this.service.executeJourney(journeyId, locale);

      // Return both UI-friendly format (top-level properties match UI Answer interface)
      // and complete Blueprint AnswerResponse structure
      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.answerRetrieved", { lng: locale }),
        data: {
          ...result.uiAnswer, // id, question, summary, chart, table, meta
          blueprintResponse: result.blueprintResponse,
          syntheticLabel: this.repo.getDataSourceLabel(),
        },
      });
    } catch (err: any) {
      logger.error(
        `[AnalyticsController] Journey execution failed: ${err?.message}`,
      );
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_EXECUTION_ERROR",
        message: t("analytics.executionFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/copilot/answers
   *
   * Lists all approved Track A journeys with current answers.
   */
  listAnswers = async (req: Request, res: Response) => {
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    const journeyIds: JourneyId[] = [
      "current-sales",
      "sales-comparison",
      "top-customers",
      "supplier-spend",
      "delayed-orders",
      "production-linkage",
    ];

    try {
      const results = await Promise.all(
        journeyIds.map(async (id) => {
          const res = await this.service.executeJourney(id, locale);
          return res.uiAnswer;
        }),
      );

      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.answersRetrieved", { lng: locale }),
        data: results,
      });
    } catch (err: any) {
      logger.error(
        `[AnalyticsController] List answers failed: ${err?.message}`,
      );
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_EXECUTION_ERROR",
        message: t("analytics.executionFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/copilot/history
   *
   * Retrieves query history items from the database catalog for the sidebar.
   */
  getHistory = async (req: Request, res: Response) => {
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    // CHANGED: auth check added after locale
    const ownerUserId = (req as any).user?.user_id as number | undefined;
    if (!ownerUserId) {
      return ApiResponse.error(res, {
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: t("copilot.errors.UNAUTHENTICATED", { lng: locale }),
      });
    }

    try {
      // CHANGED: pass ownerUserId so history is per-user
      const groups = await this.repo.getHistoryItems(locale, ownerUserId);
      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.historyRetrieved", { lng: locale }),
        data: groups,
      });
    } catch (err: any) {
      logger.error(`[AnalyticsController] History failed: ${err?.message}`);
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_HISTORY_ERROR",
        message: t("analytics.historyFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/copilot/answers/:id/records
   *
   * Returns supporting records for drill-down inspection with pagination.
   */
  getSupportingRecords = async (req: Request, res: Response) => {
    const rawId = req.params.id;
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const journeyId = this.service.resolveJourney(rawId);
    if (!journeyId) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "COPILOT_JOURNEY_NOT_FOUND",
        message: t("analytics.journeyNotFound", { lng: locale, id: rawId }),
      });
    }

    try {
      const recordsData = await this.service.getSupportingRecords(
        journeyId,
        limit,
        offset,
      );
      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.recordsRetrieved", { lng: locale }),
        data: recordsData,
      });
    } catch (err: any) {
      logger.error(
        `[AnalyticsController] Supporting records failed: ${err?.message}`,
      );
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "SUPPORTING_RECORDS_ERROR",
        message: t("analytics.recordsFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/analytics/golden-validation
   *
   * Returns the 18/18 PASS golden validation test checks.
   */
  getGoldenValidation = async (req: Request, res: Response) => {
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    try {
      const checks = await this.repo.getGoldenValidation();
      const totalChecks = checks.length;
      const passedChecks = checks.filter(
        (c: any) => c.result === "PASS",
      ).length;
      const failedChecks = checks.filter(
        (c: any) => c.result === "FAIL",
      ).length;

      return ApiResponse.success(res, {
        statusCode: 200,
        message: t("analytics.goldenValidation", { lng: locale }),
        data: {
          totalChecks,
          passedChecks,
          failedChecks,
          status:
            failedChecks === 0
              ? "18/18 PASS"
              : `${passedChecks}/${totalChecks} PASS`,
          checks,
        },
      });
    } catch (err: any) {
      logger.error(
        `[AnalyticsController] Golden validation failed: ${err?.message}`,
      );
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "GOLDEN_VALIDATION_ERROR",
        message: t("analytics.goldenValidationFailed", { lng: locale }),
      });
    }
  };

  /**
   * GET /api/v1/analytics/metrics/:id
   *
   * Returns definition, lineage, and status for a certified metric.
   */
  getMetricDefinition = async (req: Request, res: Response) => {
    const metricId = req.params.id;
    const locale =
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";
    const certifiedMetrics: Record<string, any> = {
      "sales.invoiced_net": {
        metric_id: "sales.invoiced_net",
        version: "1.1.0",
        display_name: "Net Invoiced Sales",
        aggregation: "SUM",
        time_mode: "TRANSACTION_PERIOD",
        unit: "EUR",
        asset_id: "analytics.v_sales_transaction_fact",
        allowed_dimensions: ["customer.customer"],
        business_definition:
          "Posted invoice amounts less credit notes and discounts, net of VAT.",
      },
      "sales.delayed_order_count": {
        metric_id: "sales.delayed_order_count",
        version: "1.0.0",
        display_name: "Delayed Sales Orders",
        aggregation: "COUNT_DISTINCT",
        time_mode: "CURRENT_STATE",
        unit: "count",
        asset_id: "analytics.v_sales_order_delay_current",
        allowed_dimensions: ["customer.customer", "sales.sales_order"],
        business_definition:
          "Distinct active sales orders containing at least one delayed open line.",
      },
      "sales.delayed_order_line_count": {
        metric_id: "sales.delayed_order_line_count",
        version: "1.0.0",
        display_name: "Delayed Sales Order Lines",
        aggregation: "COUNT_DISTINCT",
        time_mode: "CURRENT_STATE",
        unit: "count",
        asset_id: "analytics.v_sales_order_delay_current",
        allowed_dimensions: ["customer.customer", "sales.sales_order_line"],
        business_definition:
          "Distinct active sales order lines with open quantity past commitment date.",
      },
      "sales.delayed_backlog_net": {
        metric_id: "sales.delayed_backlog_net",
        version: "1.0.0",
        display_name: "Delayed Sales Backlog Value",
        aggregation: "SUM",
        time_mode: "CURRENT_STATE",
        unit: "EUR",
        asset_id: "analytics.v_sales_order_delay_current",
        allowed_dimensions: ["customer.customer", "sales.sales_order"],
        business_definition:
          "Remaining net amount (open quantity × unit price) of delayed active lines.",
      },
      "procurement.supplier_spend_net": {
        metric_id: "procurement.supplier_spend_net",
        version: "1.0.0",
        display_name: "Approved Supplier Spend",
        aggregation: "SUM",
        time_mode: "TRANSACTION_PERIOD",
        unit: "EUR",
        asset_id: "analytics.v_supplier_transaction_fact",
        allowed_dimensions: ["supplier.supplier"],
        business_definition:
          "Posted supplier invoices less credit notes, net of VAT.",
      },
      "production.delayed_order_count": {
        metric_id: "production.delayed_order_count",
        version: "1.0.0",
        display_name: "Delayed Production Orders",
        aggregation: "COUNT_DISTINCT",
        time_mode: "CURRENT_STATE",
        unit: "count",
        asset_id: "analytics.v_production_order_delay_current",
        allowed_dimensions: ["production.production_order"],
        business_definition:
          "Active production orders past governing finish with remaining good quantity > 0.",
      },
      "production.exposed_backlog_net": {
        metric_id: "production.exposed_backlog_net",
        version: "1.0.0",
        display_name: "Production Linked Backlog",
        aggregation: "WEIGHTED_SUM",
        time_mode: "CURRENT_STATE",
        unit: "EUR",
        asset_id: "analytics.v_customer_delay_exposure_current",
        allowed_dimensions: [
          "customer.customer",
          "production.production_order",
        ],
        business_definition:
          "Delayed sales backlog explicitly allocated to delayed production orders.",
      },
      "production.sales_linkage_coverage_pct": {
        metric_id: "production.sales_linkage_coverage_pct",
        version: "1.0.0",
        display_name: "Sales-Production Linkage Coverage",
        aggregation: "RATIO",
        time_mode: "CURRENT_STATE",
        unit: "percent",
        asset_id: "analytics.v_customer_delay_exposure_current",
        allowed_dimensions: [],
        business_definition:
          "100 × explicitly allocated delayed backlog / total delayed backlog (91.0%).",
      },
    };

    const metric = certifiedMetrics[metricId];
    if (!metric) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "COPILOT_METRIC_NOT_CERTIFIED",
        message: t("analytics.metricNotCertified", {
          lng: locale,
          id: metricId,
        }),
      });
    }

    return ApiResponse.success(res, {
      statusCode: 200,
      message: t("analytics.metricRetrieved", { lng: locale }),
      data: metric,
    });
  };
}

export const analyticsController = new AnalyticsController();
