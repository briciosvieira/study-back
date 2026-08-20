-- CreateEnum
CREATE TYPE "PolicyAcceptanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('VIEW_AUDIT_LOGS', 'EXPORT_AUDIT_LOGS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permissions" "Permission"[] DEFAULT ARRAY[]::"Permission"[];

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "requiresReacceptance" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_policy_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "status" "PolicyAcceptanceStatus" NOT NULL DEFAULT 'PENDING',
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "scheduledDeletionAt" TIMESTAMP(3),
    "deletionPausedAt" TIMESTAMP(3),
    "deletionRemainingSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_policy_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_blocklist" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "maskedEmail" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "email_blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "targetUserId" TEXT,
    "targetName" TEXT,
    "targetEmailMasked" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "method" TEXT,
    "route" TEXT,
    "httpStatus" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_incidents" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "route" TEXT,
    "method" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstOccurredAt" TIMESTAMP(3) NOT NULL,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "popupDismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_version_key" ON "policy_versions"("version");

-- CreateIndex
CREATE INDEX "policy_versions_isActive_idx" ON "policy_versions"("isActive");

-- CreateIndex
CREATE INDEX "user_policy_acceptances_userId_idx" ON "user_policy_acceptances"("userId");

-- CreateIndex
CREATE INDEX "user_policy_acceptances_status_idx" ON "user_policy_acceptances"("status");

-- CreateIndex
CREATE INDEX "user_policy_acceptances_scheduledDeletionAt_idx" ON "user_policy_acceptances"("scheduledDeletionAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_policy_acceptances_userId_policyVersionId_key" ON "user_policy_acceptances"("userId", "policyVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "email_blocklist_emailHash_key" ON "email_blocklist"("emailHash");

-- CreateIndex
CREATE INDEX "email_blocklist_removedAt_idx" ON "email_blocklist"("removedAt");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "audit_events_eventType_idx" ON "audit_events"("eventType");

-- CreateIndex
CREATE INDEX "audit_events_category_idx" ON "audit_events"("category");

-- CreateIndex
CREATE INDEX "audit_events_severity_idx" ON "audit_events"("severity");

-- CreateIndex
CREATE INDEX "audit_events_actorUserId_idx" ON "audit_events"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_events_httpStatus_idx" ON "audit_events"("httpStatus");

-- CreateIndex
CREATE INDEX "security_incidents_createdAt_idx" ON "security_incidents"("createdAt");

-- CreateIndex
CREATE INDEX "security_incidents_severity_idx" ON "security_incidents"("severity");

-- CreateIndex
CREATE INDEX "security_incidents_type_idx" ON "security_incidents"("type");

-- CreateIndex
CREATE INDEX "audit_notifications_userId_idx" ON "audit_notifications"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_notifications_userId_incidentId_key" ON "audit_notifications"("userId", "incidentId");

-- AddForeignKey
ALTER TABLE "user_policy_acceptances" ADD CONSTRAINT "user_policy_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_policy_acceptances" ADD CONSTRAINT "user_policy_acceptances_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_notifications" ADD CONSTRAINT "audit_notifications_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "security_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
