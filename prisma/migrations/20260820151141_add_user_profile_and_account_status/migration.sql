-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarStorageKey" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
