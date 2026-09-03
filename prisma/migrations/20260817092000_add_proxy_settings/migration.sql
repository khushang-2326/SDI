-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "captchaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "captchaProvider" TEXT NOT NULL DEFAULT 'mock',
    "captchaApiKey" TEXT,
    "proxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "proxyProtocol" TEXT NOT NULL DEFAULT 'http',
    "proxyHost" TEXT,
    "proxyPort" INTEGER,
    "proxyUsername" TEXT,
    "proxyPassword" TEXT,
    "proxyBandwidthSaver" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_User" ("captchaApiKey", "captchaEnabled", "captchaProvider", "createdAt", "email", "id", "name", "passwordHash", "updatedAt") SELECT "captchaApiKey", "captchaEnabled", "captchaProvider", "createdAt", "email", "id", "name", "passwordHash", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
