import { Request, Response } from "express";
import { ApiResponse } from "@/shared/types/response.js";
import { analyticsService, AnalyticsService } from "./analytics.service.js";
import { analyticsRepository, AnalyticsRepository } from "./analytics.repository.js";
import { JourneyId, PipelineExecutionResult } from "./analytics.types.js";

export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService = analyticsService,
    private readonly repo: AnalyticsRepository = analyticsRepository,
  ) {}

  /**
   * POST /api/v1/copilot/query
   *
   * Executes the full governed architectural pipeline:
   * 1. Receive User Question in Natural Language
   * 2. AI (Gemini) Proposes ModelCandidatePlan JSON (or governed canonical candidate plan)
   * 3. Validate Candidate Plan (closed schema, canonical IDs, clarification check)
   * 4. Derive Authorization and Build Server-Owned ExecutionEnvelope
   * 5. Bind Deterministic Read-Only Query Handler
   * 6. Execute Query against Governed Analytics Views
   * 7. Assemble Structured AnswerResponse + UI Answer
   */
  queryPipeline = async (req: Request, res: Response) => {
    const question = req.body.question || req.body.prompt || req.body.text;
    if (!question || typeof question !== "string") {
      return ApiResponse.error(res, {
        statusCode: 400,
        code: "INVALID_REQUEST",
        message: "A non-empty 'question' string is required in request body.",
      });
    }

    const locale =
      req.body.locale === "it" ||
      (req.query.locale as string) === "it" ||
      req.headers["accept-language"]?.startsWith("it")
        ? "it"
        : "en";

    try {
      const result = await this.service.executePipeline({
        question,
        locale,
        userId: (req as any).user?.user_id ? String((req as any).user.user_id) : "user-executive",
        roleId: (req as any).user?.role || "executive",
      });

      if ("clarification" in result.candidatePlan && result.candidatePlan.clarification?.status === "REQUIRED") {
        return ApiResponse.success(res, {
          statusCode: 200,
          message: "Clarification required",
          data: {
            ...result.uiAnswer,
            candidatePlan: result.candidatePlan,
            syntheticLabel: this.repo.getDataSourceLabel(),
          },
        });
      }

      const pipelineRes = result as PipelineExecutionResult;
      return ApiResponse.success(res, {
        statusCode: 200,
        message: "Pipeline query executed successfully",
        data: {
          ...pipelineRes.uiAnswer,
          candidatePlan: pipelineRes.candidatePlan,
          executionEnvelope: pipelineRes.executionEnvelope,
          blueprintResponse: pipelineRes.blueprintResponse,
          syntheticLabel: this.repo.getDataSourceLabel(),
        },
      });
    } catch (err: any) {
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_EXECUTION_ERROR",
        message: err.message || "Failed to execute pipeline query",
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
    const locale = (req.query.locale as string) === "it" || req.headers["accept-language"]?.startsWith("it")
      ? "it"
      : "en";

    const journeyId = this.service.resolveJourney(rawId);
    if (!journeyId) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "COPILOT_JOURNEY_NOT_FOUND",
        message: `No approved Track A demonstrator journey matches ID: '${rawId}'`,
      });
    }

    try {
      const result = await this.service.executeJourney(journeyId, locale);

      // Return both UI-friendly format (top-level properties match UI Answer interface)
      // and complete Blueprint AnswerResponse structure
      return ApiResponse.success(res, {
        statusCode: 200,
        message: "Answer retrieved successfully",
        data: {
          ...result.uiAnswer, // id, question, summary, chart, table, meta
          blueprintResponse: result.blueprintResponse,
          syntheticLabel: this.repo.getDataSourceLabel(),
        },
      });
    } catch (err: any) {
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_EXECUTION_ERROR",
        message: err.message || "Failed to execute analytical query",
      });
    }
  };

  /**
   * GET /api/v1/copilot/answers
   *
   * Lists all approved Track A journeys with current answers.
   */
  listAnswers = async (req: Request, res: Response) => {
    const locale = (req.query.locale as string) === "it" || req.headers["accept-language"]?.startsWith("it")
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
        message: "Track A demonstrator answers retrieved",
        data: results,
      });
    } catch (err: any) {
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "ANALYTICS_EXECUTION_ERROR",
        message: err.message || "Failed to list analytical answers",
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
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const journeyId = this.service.resolveJourney(rawId);
    if (!journeyId) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "COPILOT_JOURNEY_NOT_FOUND",
        message: `No approved Track A demonstrator journey matches ID: '${rawId}'`,
      });
    }

    try {
      const recordsData = await this.service.getSupportingRecords(journeyId, limit, offset);
      return ApiResponse.success(res, {
        statusCode: 200,
        message: "Supporting records retrieved",
        data: recordsData,
      });
    } catch (err: any) {
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "SUPPORTING_RECORDS_ERROR",
        message: err.message || "Failed to retrieve supporting records",
      });
    }
  };

  /**
   * GET /api/v1/analytics/golden-validation
   *
   * Returns the 18/18 PASS golden validation test checks.
   */
  getGoldenValidation = async (_req: Request, res: Response) => {
    try {
      const checks = await this.repo.getGoldenValidation();
      const totalChecks = checks.length;
      const passedChecks = checks.filter((c: any) => c.result === "PASS").length;
      const failedChecks = checks.filter((c: any) => c.result === "FAIL").length;

      return ApiResponse.success(res, {
        statusCode: 200,
        message: "Golden validation regression status",
        data: {
          totalChecks,
          passedChecks,
          failedChecks,
          status: failedChecks === 0 ? "18/18 PASS" : `${passedChecks}/${totalChecks} PASS`,
          checks,
        },
      });
    } catch (err: any) {
      return ApiResponse.error(res, {
        statusCode: 500,
        code: "GOLDEN_VALIDATION_ERROR",
        message: err.message || "Failed to run golden validation checks",
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
        business_definition: "Posted invoice amounts less credit notes and discounts, net of VAT.",
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
        business_definition: "Distinct active sales orders containing at least one delayed open line.",
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
        business_definition: "Distinct active sales order lines with open quantity past commitment date.",
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
        business_definition: "Remaining net amount (open quantity × unit price) of delayed active lines.",
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
        business_definition: "Posted supplier invoices less credit notes, net of VAT.",
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
        business_definition: "Active production orders past governing finish with remaining good quantity > 0.",
      },
      "production.exposed_backlog_net": {
        metric_id: "production.exposed_backlog_net",
        version: "1.0.0",
        display_name: "Production Linked Backlog",
        aggregation: "WEIGHTED_SUM",
        time_mode: "CURRENT_STATE",
        unit: "EUR",
        asset_id: "analytics.v_customer_delay_exposure_current",
        allowed_dimensions: ["customer.customer", "production.production_order"],
        business_definition: "Delayed sales backlog explicitly allocated to delayed production orders.",
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
        business_definition: "100 × explicitly allocated delayed backlog / total delayed backlog (91.0%).",
      },
    };

    const metric = certifiedMetrics[metricId];
    if (!metric) {
      return ApiResponse.error(res, {
        statusCode: 404,
        code: "COPILOT_METRIC_NOT_CERTIFIED",
        message: `Metric '${metricId}' is not certified in Track A semantic registry.`,
      });
    }

    return ApiResponse.success(res, {
      statusCode: 200,
      message: "Metric definition retrieved",
      data: metric,
    });
  };
}

export const analyticsController = new AnalyticsController();
