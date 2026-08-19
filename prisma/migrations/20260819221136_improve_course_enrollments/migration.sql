-- AlterTable
ALTER TABLE "course_visibilities" ADD COLUMN     "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "course_visibilities_courseId_idx" ON "course_visibilities"("courseId");

-- CreateIndex
CREATE INDEX "course_visibilities_userId_idx" ON "course_visibilities"("userId");
