import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { WebsiteImportRow, WebsiteImportSummary } from "@/types/import";

const REQUIRED_COLUMNS = ["website"] as const;

function normalizeUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS website URLs are supported.");
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function normalizeStatus(value: string) {
  const status = value.trim().toLowerCase();
  return status === "inactive" ? "inactive" : status === "active" ? "active" : "";
}

function readCell(value: unknown) {
  return String(value ?? "").trim();
}

function websiteNameFromUrl(websiteUrl: string) {
  const hostname = new URL(websiteUrl).hostname.replace(/^www\./i, "");
  const domainName = hostname.split(".")[0] || hostname;

  return domainName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getRequiredWebsiteImportColumns() {
  return REQUIRED_COLUMNS;
}

export async function importWebsitesFromExcel(
  userId: string,
  buffer: Buffer
): Promise<WebsiteImportSummary> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return {
      totalRows: 0,
      savedRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      failedRows: 0,
      message: "The workbook does not contain any sheets."
    };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const headerRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false
  });
  const headers = new Set((headerRows[0] ?? []).map((header) => String(header).trim()));
  const hasWebsiteColumn = headers.has("website") || headers.has("websiteUrl");

  if (!hasWebsiteColumn) {
    return {
      totalRows: 0,
      savedRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      failedRows: 0,
      message: "Missing required column: website"
    };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    blankrows: false
  });
  const existingWebsites = await prisma.targetWebsite.findMany({
    where: { userId },
    select: { websiteUrl: true }
  });
  const seenUrls = new Set(existingWebsites.map((website) => normalizeUrl(website.websiteUrl)));

  let duplicateRows = 0;
  let invalidRows = 0;
  let failedRows = 0;
  const validRows: WebsiteImportRow[] = [];

  for (const row of rows) {
    const rawWebsiteUrl = readCell(row.website) || readCell(row.websiteUrl);
    const rawStatus = readCell(row.status);
    const status = rawStatus ? normalizeStatus(rawStatus) : "active";
    const notes = readCell(row.notes);

    if (!rawWebsiteUrl) {
      invalidRows += 1;
      continue;
    }

    let websiteUrl: string;

    try {
      websiteUrl = normalizeUrl(rawWebsiteUrl);
    } catch {
      invalidRows += 1;
      continue;
    }

    if (!status) {
      failedRows += 1;
      continue;
    }

    const normalizedWebsiteUrl = websiteUrl;

    if (seenUrls.has(normalizedWebsiteUrl)) {
      duplicateRows += 1;
      continue;
    }

    seenUrls.add(normalizedWebsiteUrl);
    const contactPageUrl = readCell(row.contactPageUrl) || readCell(row.bookingUrl);
    validRows.push({
      websiteName: readCell(row.websiteName) || websiteNameFromUrl(websiteUrl),
      websiteUrl,
      contactPageUrl,
      status,
      notes: notes || null
    });
  }

  if (validRows.length > 0) {
    await prisma.targetWebsite.createMany({
      data: validRows.map((row) => ({ ...row, userId }))
    });
  }

  return {
    totalRows: rows.length,
    savedRows: validRows.length,
    duplicateRows,
    invalidRows,
    failedRows,
    message:
      rows.length === 0
        ? "The sheet has the right columns but no website rows."
        : undefined
  };
}
