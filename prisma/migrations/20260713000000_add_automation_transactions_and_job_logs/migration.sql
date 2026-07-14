-- CreateTable
CREATE TABLE "AutomationTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "resolvedUrl" TEXT NOT NULL,
    "targetType" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "screenshotPath" TEXT,
    "liveSubmit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AutomationTransaction_userId_createdAt_idx" ON "AutomationTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationTransaction_status_idx" ON "AutomationTransaction"("status");

-- CreateIndex
CREATE INDEX "AutomationTransaction_targetType_idx" ON "AutomationTransaction"("targetType");

-- CreateIndex
CREATE INDEX "JobLog_jobId_idx" ON "JobLog"("jobId");

-- CreateIndex
CREATE INDEX "JobLog_createdAt_idx" ON "JobLog"("createdAt");
