-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_createdById_fkey";

-- DropForeignKey
ALTER TABLE "template_library_files" DROP CONSTRAINT "template_library_files_uploadedById_fkey";

-- AlterTable
ALTER TABLE "courses" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "template_library_files" ALTER COLUMN "uploadedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_library_files" ADD CONSTRAINT "template_library_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
