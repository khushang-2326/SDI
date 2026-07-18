import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

type WebsiteReference = { id: string; websiteUrl: string };
type CachedFile = { modifiedAt: number; size: number; urls: string[] };
type FileGroupCache = Record<string, CachedFile>;

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const CACHE_FILE = path.join(process.cwd(), ".automation-jobs", "upload-file-groups.json");

function normalizeWebsiteUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "").toLowerCase();
}

async function readCache(): Promise<FileGroupCache> {
  return fs.readFile(CACHE_FILE, "utf8")
    .then((value) => JSON.parse(value) as FileGroupCache)
    .catch(() => ({}));
}

async function parseWorkbook(fileName: string) {
  const workbook = XLSX.read(await fs.readFile(path.join(UPLOAD_DIR, fileName)), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return Array.from(new Set(rows
    .map((row) => normalizeWebsiteUrl(row.website ?? row.websiteUrl))
    .filter(Boolean)));
}

export async function getUploadFileGroups(files: string[], websites: WebsiteReference[]) {
  const xlsxFiles = files.filter((fileName) => fileName.toLowerCase().endsWith(".xlsx"));
  const existingCache = await readCache();
  const nextCache: FileGroupCache = {};
  let cacheChanged = false;

  for (const fileName of xlsxFiles) {
    const stat = await fs.stat(path.join(UPLOAD_DIR, fileName)).catch(() => null);
    if (!stat) continue;
    const cached = existingCache[fileName];
    if (cached && cached.modifiedAt === stat.mtimeMs && cached.size === stat.size) {
      nextCache[fileName] = cached;
    } else {
      nextCache[fileName] = {
        modifiedAt: stat.mtimeMs,
        size: stat.size,
        urls: await parseWorkbook(fileName)
      };
      cacheChanged = true;
    }
  }

  if (Object.keys(existingCache).length !== Object.keys(nextCache).length) cacheChanged = true;
  if (cacheChanged) {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(nextCache), "utf8");
  }

  const websiteIdByUrl = new Map(websites.map((website) => [normalizeWebsiteUrl(website.websiteUrl), website.id]));
  return xlsxFiles.map((fileName) => ({
    fileName,
    displayName: fileName.replace(/^\d+-/, ""),
    websiteIds: (nextCache[fileName]?.urls ?? [])
      .map((url) => websiteIdByUrl.get(url))
      .filter((id): id is string => Boolean(id))
  }));
}
