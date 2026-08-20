-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'MANAGE_POLICY_REACTIVATION';

-- AlterTable
ALTER TABLE "user_policy_acceptances" ADD COLUMN     "policyReviewStartedAt" TIMESTAMP(3),
ADD COLUMN     "policyReviewUntil" TIMESTAMP(3),
ADD COLUMN     "reactivatedAt" TIMESTAMP(3),
ADD COLUMN     "reactivationRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "user_policy_acceptances_policyReviewUntil_idx" ON "user_policy_acceptances"("policyReviewUntil");
