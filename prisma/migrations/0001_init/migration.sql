-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'IT_REVIEWER', 'ADMIN');
CREATE TYPE "OpCo" AS ENUM ('LIQUID_INTELLIGENT_TECHNOLOGIES', 'AFRICA_DATA_CENTRES', 'LIQUID_C2', 'SASAI_FINTECH', 'CASSAVA_AI', 'CASSAVA_GROUP', 'OTHER');
CREATE TYPE "Level" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_IT_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "ApprovalAction" AS ENUM ('CREATED', 'SUBMITTED', 'REVIEW_STARTED', 'APPROVED', 'REJECTED', 'COMMENTED', 'JIRA_SYNC_QUEUED', 'JIRA_SYNCED', 'JIRA_SYNC_FAILED', 'JIRA_SYNC_RETRIED');
CREATE TYPE "JiraIssueType" AS ENUM ('EPIC', 'STORY');
CREATE TYPE "JiraSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "opco" "OpCo",
    "jobTitle" TEXT,
    "role" "Role" NOT NULL DEFAULT 'REQUESTER',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requesterId" TEXT NOT NULL,
    "title" TEXT,
    "opco" "OpCo",
    "department" TEXT,
    "impact" "Level",
    "urgency" "Level",
    "draftBrd" JSONB NOT NULL DEFAULT '{}',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "jiraIssueKey" TEXT,
    "jiraIssueUrl" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewStartedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "parts" JSONB,
    "redactions" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BRDDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "markdown" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BRDDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "ApprovalAction" NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus",
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JiraSyncTask" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "issueType" "JiraIssueType" NOT NULL,
    "status" "JiraSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "lastError" TEXT,
    "jiraIssueKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "JiraSyncTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "FeatureRequest_number_key" ON "FeatureRequest"("number");
CREATE UNIQUE INDEX "FeatureRequest_jiraIssueKey_key" ON "FeatureRequest"("jiraIssueKey");
CREATE INDEX "FeatureRequest_status_submittedAt_idx" ON "FeatureRequest"("status", "submittedAt");
CREATE INDEX "FeatureRequest_opco_idx" ON "FeatureRequest"("opco");
CREATE INDEX "FeatureRequest_impact_idx" ON "FeatureRequest"("impact");
CREATE INDEX "FeatureRequest_requesterId_updatedAt_idx" ON "FeatureRequest"("requesterId", "updatedAt");
CREATE INDEX "ConversationMessage_requestId_createdAt_idx" ON "ConversationMessage"("requestId", "createdAt");
CREATE UNIQUE INDEX "BRDDocument_requestId_version_key" ON "BRDDocument"("requestId", "version");
CREATE INDEX "ApprovalLog_requestId_createdAt_idx" ON "ApprovalLog"("requestId", "createdAt");
CREATE INDEX "JiraSyncTask_status_createdAt_idx" ON "JiraSyncTask"("status", "createdAt");
CREATE INDEX "JiraSyncTask_requestId_idx" ON "JiraSyncTask"("requestId");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "FeatureRequest" ADD CONSTRAINT "FeatureRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureRequest" ADD CONSTRAINT "FeatureRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BRDDocument" ADD CONSTRAINT "BRDDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BRDDocument" ADD CONSTRAINT "BRDDocument_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JiraSyncTask" ADD CONSTRAINT "JiraSyncTask_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FeatureRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
