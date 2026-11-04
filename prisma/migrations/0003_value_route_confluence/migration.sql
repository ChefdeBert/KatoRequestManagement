-- Business value assessment, development-route assessment and Confluence publishing

-- AlterEnum
ALTER TYPE "ApprovalAction" ADD VALUE 'ASSESSMENT_REQUESTED';
ALTER TYPE "ApprovalAction" ADD VALUE 'ASSESSMENT_COMPLETED';
ALTER TYPE "ApprovalAction" ADD VALUE 'ASSESSMENT_FAILED';
ALTER TYPE "ApprovalAction" ADD VALUE 'CONFLUENCE_PUBLISHED';
ALTER TYPE "ApprovalAction" ADD VALUE 'CONFLUENCE_SYNC_FAILED';
ALTER TYPE "ApprovalAction" ADD VALUE 'CONFLUENCE_SYNC_RETRIED';

-- CreateEnum
CREATE TYPE "DevelopmentRoute" AS ENUM ('AUTONOMOUS', 'AI_ASSISTED', 'HUMAN_LED');
CREATE TYPE "AssessmentStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "SyncState" AS ENUM ('NOT_SYNCED', 'PENDING', 'SYNCED', 'FAILED');

-- AlterTable
ALTER TABLE "FeatureRequest"
    ADD COLUMN "statedRevenueUsd" DECIMAL(15,2),
    ADD COLUMN "statedEbitdaUsd" DECIMAL(15,2),
    ADD COLUMN "statedCashFlowUsd" DECIMAL(15,2),
    ADD COLUMN "assessedRevenueUsd" DECIMAL(15,2),
    ADD COLUMN "assessedEbitdaUsd" DECIMAL(15,2),
    ADD COLUMN "assessedCashFlowUsd" DECIMAL(15,2),
    ADD COLUMN "valueScore" INTEGER,
    ADD COLUMN "assessmentStatus" "AssessmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    ADD COLUMN "autonomyScore" INTEGER,
    ADD COLUMN "recommendedRoute" "DevelopmentRoute",
    ADD COLUMN "approvedRoute" "DevelopmentRoute",
    ADD COLUMN "confluencePageId" TEXT,
    ADD COLUMN "confluencePageUrl" TEXT,
    ADD COLUMN "confluenceSyncState" "SyncState" NOT NULL DEFAULT 'NOT_SYNCED',
    ADD COLUMN "confluenceSyncedAt" TIMESTAMP(3),
    ADD COLUMN "confluenceLastError" TEXT;

-- CreateTable
CREATE TABLE "RequestAssessment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "brdDocumentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "assessedRevenueUsd" DECIMAL(15,2) NOT NULL,
    "assessedEbitdaUsd" DECIMAL(15,2) NOT NULL,
    "assessedCashFlowUsd" DECIMAL(15,2) NOT NULL,
    "valueScore" INTEGER NOT NULL,
    "financial" JSONB NOT NULL,
    "autonomyScore" INTEGER NOT NULL,
    "recommendedRoute" "DevelopmentRoute" NOT NULL,
    "autonomy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureRequest_confluencePageId_key" ON "FeatureRequest"("confluencePageId");
CREATE INDEX "FeatureRequest_recommendedRoute_idx" ON "FeatureRequest"("recommendedRoute");
CREATE INDEX "FeatureRequest_assessedEbitdaUsd_idx" ON "FeatureRequest"("assessedEbitdaUsd");
CREATE UNIQUE INDEX "RequestAssessment_requestId_version_key" ON "RequestAssessment"("requestId", "version");

-- AddForeignKey
ALTER TABLE "RequestAssessment" ADD CONSTRAINT "RequestAssessment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestAssessment" ADD CONSTRAINT "RequestAssessment_brdDocumentId_fkey" FOREIGN KEY ("brdDocumentId") REFERENCES "BRDDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Assessments are part of the immutable audit trail (function from 0002)
CREATE TRIGGER kato_immutable_row BEFORE UPDATE OR DELETE ON "RequestAssessment" FOR EACH ROW EXECUTE FUNCTION kato_forbid_mutation();
CREATE TRIGGER kato_immutable_truncate BEFORE TRUNCATE ON "RequestAssessment" FOR EACH STATEMENT EXECUTE FUNCTION kato_forbid_mutation();
