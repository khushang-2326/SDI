-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TargetWebsite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteName" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "contactPageUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "TargetWebsite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubmissionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    CONSTRAINT "SubmissionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionJob_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubmissionResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "message" TEXT,
    "screenshotPath" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "jobId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "targetWebsiteId" TEXT NOT NULL,
    CONSTRAINT "SubmissionResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SubmissionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionResult_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionResult_targetWebsiteId_fkey" FOREIGN KEY ("targetWebsiteId") REFERENCES "TargetWebsite" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Lead_userId_idx" ON "Lead"("userId");

-- CreateIndex
CREATE INDEX "TargetWebsite_userId_idx" ON "TargetWebsite"("userId");

-- CreateIndex
CREATE INDEX "TargetWebsite_status_idx" ON "TargetWebsite"("status");

-- CreateIndex
CREATE INDEX "SubmissionJob_userId_idx" ON "SubmissionJob"("userId");

-- CreateIndex
CREATE INDEX "SubmissionJob_leadId_idx" ON "SubmissionJob"("leadId");

-- CreateIndex
CREATE INDEX "SubmissionJob_status_idx" ON "SubmissionJob"("status");

-- CreateIndex
CREATE INDEX "SubmissionResult_jobId_idx" ON "SubmissionResult"("jobId");

-- CreateIndex
CREATE INDEX "SubmissionResult_leadId_idx" ON "SubmissionResult"("leadId");

-- CreateIndex
CREATE INDEX "SubmissionResult_targetWebsiteId_idx" ON "SubmissionResult"("targetWebsiteId");

-- CreateIndex
CREATE INDEX "SubmissionResult_status_idx" ON "SubmissionResult"("status");
