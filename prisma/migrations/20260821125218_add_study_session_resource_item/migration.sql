-- AlterTable
ALTER TABLE "study_sessions" ADD COLUMN     "pdfItemId" TEXT,
ADD COLUMN     "videoItemId" TEXT;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_pdfItemId_fkey" FOREIGN KEY ("pdfItemId") REFERENCES "pdf_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_videoItemId_fkey" FOREIGN KEY ("videoItemId") REFERENCES "video_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
