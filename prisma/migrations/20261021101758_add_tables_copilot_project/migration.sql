-- CreateEnum
CREATE TYPE "public"."RoleCode" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "public"."answer_status" AS ENUM ('SUCCESS', 'PARTIAL', 'EMPTY', 'REFUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."artifact_state" AS ENUM ('AVAILABLE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."conversation_state" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."definition_state" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."evaluation_result" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "public"."export_format" AS ENUM ('CSV', 'EXCEL', 'PDF');

-- CreateEnum
CREATE TYPE "public"."feedback_category" AS ENUM ('CORRECT', 'INCORRECT', 'WRONG_METRIC', 'MISSING_DATA');

-- CreateEnum
CREATE TYPE "public"."feedback_review_state" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "public"."job_state" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."locale_code" AS ENUM ('en', 'it');

-- CreateEnum
CREATE TYPE "public"."message_kind" AS ENUM ('QUESTION', 'CLARIFICATION_REQUEST', 'CLARIFICATION_REPLY');

-- CreateEnum
CREATE TYPE "public"."message_role" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."narration_source" AS ENUM ('MODEL', 'SERVER_TEMPLATE');

-- CreateEnum
CREATE TYPE "public"."retention_class" AS ENUM ('STANDARD', 'SHORT', 'LEGAL_HOLD');

-- CreateEnum
CREATE TYPE "public"."schedule_cadence" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "public"."schedule_state" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED_OWNER_INACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "public"."calendar_definition" (
    "id" SERIAL NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "calendar_type" TEXT NOT NULL,
    "week_system" TEXT NOT NULL,
    "week_start_day" SMALLINT NOT NULL,
    "year_start_month" SMALLINT NOT NULL DEFAULT 1,
    "description" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_asset" (
    "asset_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "object_schema" TEXT NOT NULL DEFAULT 'public',
    "object_name" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "grain" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "data_classification" TEXT NOT NULL DEFAULT 'INTERNAL',
    "contains_pii" BOOLEAN NOT NULL DEFAULT false,
    "target_freshness_minutes" INTEGER,
    "certification_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "source_versions" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "data_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_quality_rule" (
    "id" SERIAL NOT NULL,
    "rule_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "asset_version" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "target_column" TEXT,
    "rule_config" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT NOT NULL,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dimension" (
    "dimension_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "sensitivity_class" TEXT NOT NULL DEFAULT 'INTERNAL',
    "allow_filter" BOOLEAN NOT NULL DEFAULT true,
    "allow_group" BOOLEAN NOT NULL DEFAULT true,
    "allow_sort" BOOLEAN NOT NULL DEFAULT true,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metric" (
    "metric_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metric_dimension_rule" (
    "metric_id" TEXT NOT NULL,
    "metric_version" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "allow_filter" BOOLEAN NOT NULL DEFAULT true,
    "allow_group" BOOLEAN NOT NULL DEFAULT true,
    "allow_sort" BOOLEAN NOT NULL DEFAULT true,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "metric_dimension_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metric_lineage" (
    "metric_id" TEXT NOT NULL,
    "metric_version" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "asset_version" TEXT NOT NULL,
    "lineage_role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "transformation_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "metric_lineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metric_version" (
    "metric_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "business_definition" TEXT,
    "grain" TEXT,
    "unit" TEXT,
    "aggregation" TEXT,
    "time_mode" TEXT,
    "formula_ast" JSONB,
    "formula_hash" TEXT,
    "null_zero_policy" TEXT,
    "reversal_policy" TEXT,
    "cancellation_reopen_policy" TEXT,
    "currency_policy" JSONB,
    "rounding_policy" TEXT,
    "additivity" TEXT,
    "late_arrival_restatement_policy" TEXT,
    "freshness_max_age_minutes" INTEGER,
    "reconciliation_policy" JSONB,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(6),
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "metric_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."refresh_batch" (
    "id" SERIAL NOT NULL,
    "batch_key" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "asset_version" TEXT NOT NULL,
    "batch_type" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "source_cutoff_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL,
    "row_count" BIGINT,
    "transformation_version" TEXT,
    "data_quality_status" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "reconciliation_status" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."semantic_term" (
    "locale" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "metric_id" TEXT,
    "dimension_id" TEXT,
    "is_preferred_term" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,

    CONSTRAINT "semantic_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."snapshot_manifest" (
    "id" SERIAL NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "snapshot_at" TIMESTAMPTZ(6) NOT NULL,
    "reporting_timezone" TEXT NOT NULL,
    "snapshot_type" TEXT NOT NULL,
    "business_period_label" TEXT,
    "synthetic_data" BOOLEAN NOT NULL DEFAULT false,
    "certification_state" TEXT NOT NULL,
    "source_cutoff_at" TIMESTAMPTZ(6),
    "data_quality_status" TEXT NOT NULL,
    "reconciliation_status" TEXT NOT NULL,
    "refresh_batch_key" TEXT,
    "asset_manifest" JSONB NOT NULL,
    "metric_manifest" JSONB NOT NULL,
    "output_hash" TEXT NOT NULL,
    "supersedes_snapshot_id" TEXT,
    "supersedes_version" TEXT,
    "restated" BOOLEAN NOT NULL DEFAULT false,
    "restatement_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL DEFAULT CURRENT_USER,

    CONSTRAINT "snapshot_manifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."answer" (
    "id" SERIAL NOT NULL,
    "answer_uuid" UUID NOT NULL,
    "request_uuid" UUID NOT NULL,
    "policy_decision_uuid" UUID,
    "conversation_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "status" "public"."answer_status" NOT NULL,
    "locale" "public"."locale_code" NOT NULL DEFAULT 'en',
    "retention_class" "public"."retention_class" NOT NULL DEFAULT 'STANDARD',
    "journey_no" INTEGER,
    "plan_hash" TEXT,
    "normalized_plan" JSONB,
    "metric_versions" JSONB,
    "dataset_id" TEXT,
    "dataset_version" TEXT,
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    "as_of" TIMESTAMPTZ(6),
    "structured_result_ref" TEXT,
    "warnings" JSONB,
    "synthetic_label" BOOLEAN NOT NULL DEFAULT true,
    "narration_source" "public"."narration_source",
    "policy_version" TEXT,
    "scope_hash" TEXT,
    "query_fingerprint" TEXT,
    "output_hash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_event" (
    "id" BIGSERIAL NOT NULL,
    "event_day" DATE NOT NULL,
    "sequence" INTEGER NOT NULL,
    "previous_hash" TEXT,
    "event_hash" TEXT NOT NULL,
    "signature_manifest" TEXT,
    "request_uuid" UUID NOT NULL,
    "conversation_id" INTEGER,
    "subject_ref" TEXT,
    "event_type" TEXT NOT NULL,
    "plan_hash" TEXT,
    "policy_version" TEXT,
    "scope_hash" TEXT,
    "query_fingerprint" TEXT,
    "output_hash" TEXT,
    "status" TEXT,
    "warning_codes" TEXT[],
    "redacted_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation" (
    "id" SERIAL NOT NULL,
    "conversation_uuid" UUID NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "locale" "public"."locale_code" NOT NULL DEFAULT 'en',
    "state" "public"."conversation_state" NOT NULL DEFAULT 'ACTIVE',
    "retention_class" "public"."retention_class" NOT NULL DEFAULT 'STANDARD',
    "dataset_id" TEXT,
    "dataset_version" TEXT,
    "analytical_context" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_message" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "role" "public"."message_role" NOT NULL,
    "kind" "public"."message_kind" NOT NULL,
    "text" TEXT,
    "text_redacted" BOOLEAN NOT NULL DEFAULT false,
    "question_hash" TEXT,
    "locale" "public"."locale_code" NOT NULL DEFAULT 'en',
    "request_uuid" UUID,
    "idempotency_key" TEXT,
    "canonical_body_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluation_run" (
    "id" SERIAL NOT NULL,
    "suite" TEXT NOT NULL,
    "release_version" TEXT NOT NULL,
    "semantic_version" TEXT,
    "dataset_id" TEXT,
    "dataset_version" TEXT,
    "prompt_version" TEXT,
    "model_version" TEXT,
    "policy_version" TEXT,
    "total_checks" INTEGER NOT NULL,
    "passed_checks" INTEGER NOT NULL,
    "failed_checks" INTEGER NOT NULL,
    "result" "public"."evaluation_result" NOT NULL,
    "details" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."export_job" (
    "id" SERIAL NOT NULL,
    "export_uuid" UUID NOT NULL,
    "answer_id" INTEGER,
    "owner_user_id" INTEGER NOT NULL,
    "format" "public"."export_format" NOT NULL,
    "state" "public"."job_state" NOT NULL DEFAULT 'QUEUED',
    "artifact_state" "public"."artifact_state",
    "artifact_ref" TEXT,
    "scope_hash" TEXT,
    "masking_profile" TEXT,
    "idempotency_key" TEXT,
    "synthetic_label" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."model_usage" (
    "id" SERIAL NOT NULL,
    "request_uuid" UUID NOT NULL,
    "answer_id" INTEGER,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT,
    "purpose" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "estimated_cost" DECIMAL(12,6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_definition" (
    "id" SERIAL NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" "public"."definition_state" NOT NULL DEFAULT 'DRAFT',
    "report_template" TEXT,
    "config" JSONB NOT NULL,
    "filters" JSONB,
    "metric_versions" JSONB NOT NULL,
    "saved_question_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_run" (
    "id" SERIAL NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "planned_run_at" TIMESTAMPTZ(6) NOT NULL,
    "state" "public"."job_state" NOT NULL DEFAULT 'QUEUED',
    "answer_id" INTEGER,
    "artifact_ref" TEXT,
    "artifact_state" "public"."artifact_state",
    "error_code" TEXT,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_schedule" (
    "id" SERIAL NOT NULL,
    "report_definition_id" INTEGER NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "cadence" "public"."schedule_cadence" NOT NULL,
    "state" "public"."schedule_state" NOT NULL DEFAULT 'DRAFT',
    "metric_versions" JSONB NOT NULL,
    "next_run_at" TIMESTAMPTZ(6),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "role_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "public"."saved_question" (
    "id" SERIAL NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "normalized_plan" JSONB NOT NULL,
    "plan_hash" TEXT,
    "metric_versions" JSONB NOT NULL,
    "locale" "public"."locale_code" NOT NULL DEFAULT 'en',
    "source_answer_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "saved_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_feedback" (
    "id" SERIAL NOT NULL,
    "answer_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "category" "public"."feedback_category" NOT NULL,
    "comment" TEXT,
    "review_state" "public"."feedback_review_state" NOT NULL DEFAULT 'NEW',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "user_id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "emergency_contact" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_token" TEXT,
    "updated_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "src_hash" TEXT,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT true,
    "email_verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."user_otp" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_otp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_calendar_definition" ON "public"."calendar_definition"("calendar_id", "version");

-- CreateIndex
CREATE INDEX "ix_data_asset_certification" ON "public"."data_asset"("certification_state");

-- CreateIndex
CREATE INDEX "ix_data_asset_object" ON "public"."data_asset"("object_schema", "object_name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_data_asset_object_version" ON "public"."data_asset"("object_schema", "object_name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_data_asset_version" ON "public"."data_asset"("asset_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_rule_rule_id_key" ON "public"."data_quality_rule"("rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_public_dimension_dimension_id" ON "public"."dimension"("dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_public_metric_metric_id" ON "public"."metric"("metric_id");

-- CreateIndex
CREATE INDEX "ix_metric_dimension_rule_dimension" ON "public"."metric_dimension_rule"("dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_metric_dimension_rule" ON "public"."metric_dimension_rule"("metric_id", "metric_version", "dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_metric_lineage" ON "public"."metric_lineage"("metric_id", "metric_version", "asset_id", "asset_version");

-- CreateIndex
CREATE INDEX "ix_metric_version_metric" ON "public"."metric_version"("metric_id");

-- CreateIndex
CREATE INDEX "ix_metric_version_state" ON "public"."metric_version"("lifecycle_state");

-- CreateIndex
CREATE UNIQUE INDEX "uq_metric_version" ON "public"."metric_version"("metric_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_refresh_batch" ON "public"."refresh_batch"("asset_id", "asset_version", "batch_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_snapshot_manifest" ON "public"."snapshot_manifest"("snapshot_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "answer_answer_uuid_key" ON "public"."answer"("answer_uuid");

-- CreateIndex
CREATE INDEX "answer_conversation_id_created_at_idx" ON "public"."answer"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "answer_request_uuid_idx" ON "public"."answer"("request_uuid");

-- CreateIndex
CREATE INDEX "audit_event_event_type_created_at_idx" ON "public"."audit_event"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_request_uuid_idx" ON "public"."audit_event"("request_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_event_day_sequence_key" ON "public"."audit_event"("event_day", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_conversation_uuid_key" ON "public"."conversation"("conversation_uuid");

-- CreateIndex
CREATE INDEX "conversation_owner_user_id_created_at_idx" ON "public"."conversation"("owner_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_message_request_uuid_key" ON "public"."conversation_message"("request_uuid");

-- CreateIndex
CREATE INDEX "conversation_message_conversation_id_created_at_idx" ON "public"."conversation_message"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_message_conversation_id_idempotency_key_key" ON "public"."conversation_message"("conversation_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "evaluation_run_release_version_created_at_idx" ON "public"."evaluation_run"("release_version", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_job_export_uuid_key" ON "public"."export_job"("export_uuid");

-- CreateIndex
CREATE INDEX "export_job_owner_user_id_expires_at_idx" ON "public"."export_job"("owner_user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_job_owner_user_id_idempotency_key_key" ON "public"."export_job"("owner_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "model_usage_created_at_idx" ON "public"."model_usage"("created_at");

-- CreateIndex
CREATE INDEX "model_usage_request_uuid_idx" ON "public"."model_usage"("request_uuid");

-- CreateIndex
CREATE INDEX "report_definition_owner_user_id_idx" ON "public"."report_definition"("owner_user_id");

-- CreateIndex
CREATE INDEX "report_run_lease_expires_at_idx" ON "public"."report_run"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_run_schedule_id_planned_run_at_key" ON "public"."report_run"("schedule_id", "planned_run_at");

-- CreateIndex
CREATE INDEX "report_schedule_lease_expires_at_idx" ON "public"."report_schedule"("lease_expires_at");

-- CreateIndex
CREATE INDEX "report_schedule_state_next_run_at_idx" ON "public"."report_schedule"("state", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_code_key" ON "public"."roles"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "saved_question_owner_user_id_title_version_key" ON "public"."saved_question"("owner_user_id", "title", "version");

-- CreateIndex
CREATE INDEX "user_feedback_review_state_created_at_idx" ON "public"."user_feedback"("review_state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_feedback_answer_id_user_id_category_key" ON "public"."user_feedback"("answer_id", "user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "public"."users"("mobile");

-- CreateIndex
CREATE INDEX "ix_user_otp_lookup" ON "public"."user_otp"("user_id", "purpose", "created_at");

-- AddForeignKey
ALTER TABLE "public"."data_quality_rule" ADD CONSTRAINT "fk_data_quality_rule_asset" FOREIGN KEY ("asset_id", "asset_version") REFERENCES "public"."data_asset"("asset_id", "version") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."metric_dimension_rule" ADD CONSTRAINT "fk_metric_dimension_rule_dimension" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimension"("dimension_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."metric_dimension_rule" ADD CONSTRAINT "fk_metric_dimension_rule_metric_version" FOREIGN KEY ("metric_id", "metric_version") REFERENCES "public"."metric_version"("metric_id", "version") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."metric_lineage" ADD CONSTRAINT "fk_metric_lineage_data_asset" FOREIGN KEY ("asset_id", "asset_version") REFERENCES "public"."data_asset"("asset_id", "version") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."metric_lineage" ADD CONSTRAINT "fk_metric_lineage_metric_version" FOREIGN KEY ("metric_id", "metric_version") REFERENCES "public"."metric_version"("metric_id", "version") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."metric_version" ADD CONSTRAINT "fk_metric_version_metric" FOREIGN KEY ("metric_id") REFERENCES "public"."metric"("metric_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."refresh_batch" ADD CONSTRAINT "fk_refresh_batch_asset" FOREIGN KEY ("asset_id", "asset_version") REFERENCES "public"."data_asset"("asset_id", "version") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."semantic_term" ADD CONSTRAINT "fk_semantic_term_dimension" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimension"("dimension_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."semantic_term" ADD CONSTRAINT "fk_semantic_term_metric" FOREIGN KEY ("metric_id") REFERENCES "public"."metric"("metric_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."answer" ADD CONSTRAINT "answer_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."answer" ADD CONSTRAINT "answer_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation" ADD CONSTRAINT "conversation_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."export_job" ADD CONSTRAINT "export_job_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."model_usage" ADD CONSTRAINT "model_usage_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_definition" ADD CONSTRAINT "report_definition_saved_question_id_fkey" FOREIGN KEY ("saved_question_id") REFERENCES "public"."saved_question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_run" ADD CONSTRAINT "report_run_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_run" ADD CONSTRAINT "report_run_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_schedule" ADD CONSTRAINT "report_schedule_report_definition_id_fkey" FOREIGN KEY ("report_definition_id") REFERENCES "public"."report_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."saved_question" ADD CONSTRAINT "saved_question_source_answer_id_fkey" FOREIGN KEY ("source_answer_id") REFERENCES "public"."answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_feedback" ADD CONSTRAINT "user_feedback_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_otp" ADD CONSTRAINT "user_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
