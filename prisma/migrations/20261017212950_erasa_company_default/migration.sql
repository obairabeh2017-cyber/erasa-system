-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "companyName" TEXT NOT NULL DEFAULT 'شركة ايراسا',
    "companyPhone" TEXT,
    "companyAddress" TEXT,
    "invoiceFooter" TEXT,
    "backupKeep" INTEGER NOT NULL DEFAULT 30,
    "backupIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "lastAutoBackupAt" DATETIME,
    "debtReminderDaysAhead" INTEGER NOT NULL DEFAULT 3,
    "salaryDayOfMonth" INTEGER NOT NULL DEFAULT 28,
    "salaryReminderDays" INTEGER NOT NULL DEFAULT 3,
    "lastReminderRunAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("backupIntervalHours", "backupKeep", "companyAddress", "companyName", "companyPhone", "debtReminderDaysAhead", "id", "invoiceFooter", "lastAutoBackupAt", "lastReminderRunAt", "salaryDayOfMonth", "salaryReminderDays", "updatedAt") SELECT "backupIntervalHours", "backupKeep", "companyAddress", "companyName", "companyPhone", "debtReminderDaysAhead", "id", "invoiceFooter", "lastAutoBackupAt", "lastReminderRunAt", "salaryDayOfMonth", "salaryReminderDays", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
