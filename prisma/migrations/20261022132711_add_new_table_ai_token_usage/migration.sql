-- CreateTable
CREATE TABLE "public"."ai_token_usage" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "request_id" VARCHAR(255) NOT NULL,
    "endpoint" VARCHAR(100) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "thought_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ai_token_usage_user_created" ON "public"."ai_token_usage"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_token_usage_request_endpoint" ON "public"."ai_token_usage"("request_id", "endpoint");
