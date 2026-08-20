-- CreateTable
CREATE TABLE "audit_archive_logs" (
    "id" TEXT NOT NULL,
    "archiveDate" TIMESTAMP(3) NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_archive_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_archive_logs_archiveDate_key" ON "audit_archive_logs"("archiveDate");
