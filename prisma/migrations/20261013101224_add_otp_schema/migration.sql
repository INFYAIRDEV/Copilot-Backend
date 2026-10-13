-- AlterTable
ALTER TABLE "analytics"."users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "is_email_verified" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "analytics"."user_otp" (
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
CREATE INDEX "ix_user_otp_lookup" ON "analytics"."user_otp"("user_id", "purpose", "created_at");

-- AddForeignKey
ALTER TABLE "analytics"."user_otp" ADD CONSTRAINT "user_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "analytics"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
