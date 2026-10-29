-- CreateTable
CREATE TABLE "public"."shared_conversation" (
    "id" SERIAL NOT NULL,
    "share_id" VARCHAR(64) NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(255),
    "snapshot_data" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(6),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_conversation_share_id_key" ON "public"."shared_conversation"("share_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_conversation_conversation_id_key" ON "public"."shared_conversation"("conversation_id");

-- CreateIndex
CREATE INDEX "shared_conversation_share_id_idx" ON "public"."shared_conversation"("share_id");

-- CreateIndex
CREATE INDEX "shared_conversation_user_id_idx" ON "public"."shared_conversation"("user_id");

-- AddForeignKey
ALTER TABLE "public"."shared_conversation" ADD CONSTRAINT "shared_conversation_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shared_conversation" ADD CONSTRAINT "shared_conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
