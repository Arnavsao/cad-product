-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "override_plan" "billing_plan",
ADD COLUMN     "override_reason" TEXT,
ADD COLUMN     "override_until" TIMESTAMP(3);
