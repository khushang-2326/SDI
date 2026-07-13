import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const dbPath = path.join(root, "prisma", "dev.db");
const migrationName = "20260706000000_init";
const migrationPath = path.join(
  root,
  "prisma",
  "migrations",
  migrationName,
  "migration.sql"
);

const sql = fs.readFileSync(migrationPath, "utf8");
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys=ON;");
db.exec(sql);
db.exec(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );
`);
db.prepare(`
  INSERT OR IGNORE INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
  VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)
`).run(migrationName, "manual-dev-apply", migrationName);
db.close();

console.log(`Applied development migration to ${dbPath}`);
