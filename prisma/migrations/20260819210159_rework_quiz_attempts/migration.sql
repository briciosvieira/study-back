/*
  Warnings:

  - You are about to drop the column `chosenOption` on the `attempt_answers` table. All the data in the column will be lost.
  - You are about to drop the column `timeSpentSec` on the `attempt_answers` table. All the data in the column will be lost.
  - You are about to drop the column `currentQuestionId` on the `quiz_attempts` table. All the data in the column will be lost.
  - You are about to drop the column `currentQuestionShownAt` on the `quiz_attempts` table. All the data in the column will be lost.
  - You are about to drop the column `finishedAt` on the `quiz_attempts` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "attempt_answers" DROP COLUMN "chosenOption",
DROP COLUMN "timeSpentSec",
ADD COLUMN     "elapsedSeconds" INTEGER,
ADD COLUMN     "overtimeSeconds" INTEGER,
ADD COLUMN     "questionStartedAt" TIMESTAMP(3),
ADD COLUMN     "selectedOptionId" TEXT,
ALTER COLUMN "correct" DROP NOT NULL,
ALTER COLUMN "answeredAt" DROP NOT NULL,
ALTER COLUMN "answeredAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quiz_attempts" DROP COLUMN "currentQuestionId",
DROP COLUMN "currentQuestionShownAt",
DROP COLUMN "finishedAt",
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "status" "QuizAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS';

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "question_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
