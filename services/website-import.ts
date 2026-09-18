import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { WebsiteImportRow, WebsiteImportSummary } from "@/types/import";
import { normalizeInputTargetUrl } from "@/services/url-normalizer";

const REQUIRED_COLUMNS = ["website"] as const;

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
    select: { id: true, websiteUrl: true, contactPageUrl: true }
  });
  const seenUrls = new Set(
    existingWebsites
      .map((w) => normalizeInputTargetUrl(w.websiteUrl).normalizedTargetUrl)
      .filter((u): u is string => Boolean(u))
  );
  const existingByUrl = new Map(
    existingWebsites
      .map((w) => [normalizeInputTargetUrl(w.websiteUrl).normalizedTargetUrl, w] as const)
      .filter(([u]) => Boolean(u)) as [string, (typeof existingWebsites)[0]][]
  );

  let duplicateRows = 0;
  let invalidRows = 0;
  let failedRows = 0;
  const validRows: WebsiteImportRow[] = [];

  for (const row of rows) {
    const rawWebsiteUrl = readCell(row.website) || readCell(row.websiteUrl);
    const rawStatus = readCell(row.status);
    const status = rawStatus ? normalizeStatus(rawStatus) : "active";
    const notes = readCell(row.notes);

    const normTarget = normalizeInputTargetUrl(rawWebsiteUrl);
    if (!normTarget.isValidTarget || !normTarget.normalizedTargetUrl) {
      invalidRows += 1;
      continue;
    }

    const websiteUrl = normTarget.normalizedTargetUrl;
    let contactPageUrl = "";

    const rawContactPageUrl =
      readCell(row.contactPageUrl) ||
      readCell(row.directContactUrl) ||
      readCell(row.bookingUrl);
    if (rawContactPageUrl) {
      const normContact = normalizeInputTargetUrl(rawContactPageUrl);
      if (normContact.isValidTarget && normContact.normalizedTargetUrl) {
        contactPageUrl = normContact.normalizedTargetUrl;
      }
    }

    if (!status) {
      failedRows += 1;
      continue;
    }

    const normalizedWebsiteUrl = websiteUrl;

    if (seenUrls.has(normalizedWebsiteUrl)) {
      const existing = existingByUrl.get(normalizedWebsiteUrl);
      if (existing && contactPageUrl && existing.contactPageUrl !== contactPageUrl) {
        await prisma.targetWebsite.update({
          where: { id: existing.id },
          data: { contactPageUrl }
        });
      }
      duplicateRows += 1;
      continue;
    }

    seenUrls.add(normalizedWebsiteUrl);
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
