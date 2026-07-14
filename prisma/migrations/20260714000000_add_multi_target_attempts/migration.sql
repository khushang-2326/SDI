CREATE TABLE "DiscoveredSubmissionTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "executionOrder" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "targetWebsiteId" TEXT NOT NULL,
    CONSTRAINT "DiscoveredSubmissionTarget_targetWebsiteId_fkey" FOREIGN KEY ("targetWebsiteId") REFERENCES "TargetWebsite" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SubmissionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "targetType" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "executionOrder" INTEGER NOT NULL,
    "message" TEXT,
    "errorMessage" TEXT,
    "screenshotPath" TEXT,
    "screenshotPaths" TEXT,
    "metadata" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submissionResultId" TEXT NOT NULL,
    "discoveredTargetId" TEXT,
    CONSTRAINT "SubmissionAttempt_submissionResultId_fkey" FOREIGN KEY ("submissionResultId") REFERENCES "SubmissionResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionAttempt_discoveredTargetId_fkey" FOREIGN KEY ("discoveredTargetId") REFERENCES "DiscoveredSubmissionTarget" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SubmissionAttemptLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptId" TEXT NOT NULL,
    CONSTRAINT "SubmissionAttemptLog_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DiscoveredSubmissionTarget_targetWebsiteId_targetType_url_key" ON "DiscoveredSubmissionTarget"("targetWebsiteId", "targetType", "url");
CREATE INDEX "DiscoveredSubmissionTarget_targetWebsiteId_executionOrder_idx" ON "DiscoveredSubmissionTarget"("targetWebsiteId", "executionOrder");
CREATE INDEX "DiscoveredSubmissionTarget_targetType_idx" ON "DiscoveredSubmissionTarget"("targetType");
CREATE INDEX "SubmissionAttempt_submissionResultId_executionOrder_idx" ON "SubmissionAttempt"("submissionResultId", "executionOrder");
CREATE INDEX "SubmissionAttempt_discoveredTargetId_idx" ON "SubmissionAttempt"("discoveredTargetId");
CREATE INDEX "SubmissionAttempt_status_idx" ON "SubmissionAttempt"("status");
CREATE INDEX "SubmissionAttempt_targetType_idx" ON "SubmissionAttempt"("targetType");
CREATE INDEX "SubmissionAttemptLog_attemptId_createdAt_idx" ON "SubmissionAttemptLog"("attemptId", "createdAt");
