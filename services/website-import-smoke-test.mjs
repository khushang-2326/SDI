import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const requiredColumns = [
  "websiteName",
  "websiteUrl",
  "contactPageUrl",
  "status",
  "notes"
];
const createdWebsiteIds = [];

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

try {
  const user = await prisma.user.upsert({
    where: { email: "demo@lead-auto-submitter.local" },
    update: {},
    create: {
      name: "Demo User",
      email: "demo@lead-auto-submitter.local",
      passwordHash: "demo-mode"
    }
  });

  const stamp = Date.now();
  const duplicateUrl = `https://duplicate-${stamp}.example.com`;
  const existingDuplicate = await prisma.targetWebsite.create({
    data: {
      websiteName: "Existing Duplicate",
      websiteUrl: duplicateUrl,
      contactPageUrl: `${duplicateUrl}/contact`,
      status: "active",
      notes: "Pre-existing row",
      userId: user.id
    }
  });
  createdWebsiteIds.push(existingDuplicate.id);

  const rows = [
    {
      websiteName: "Saved Demo A",
      websiteUrl: `https://saved-a-${stamp}.example.com`,
      contactPageUrl: `https://saved-a-${stamp}.example.com/contact`,
      status: "active",
      notes: "Should save"
    },
    {
      websiteName: "Duplicate Demo",
      websiteUrl: duplicateUrl,
      contactPageUrl: `${duplicateUrl}/contact`,
      status: "active",
      notes: "Should skip"
    },
    {
      websiteName: "Failed Demo",
      websiteUrl: "",
      contactPageUrl: "https://failed.example.com/contact",
      status: "active",
      notes: "Should fail"
    }
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: requiredColumns });
  XLSX.utils.book_append_sheet(workbook, worksheet, "Websites");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsedWorkbook = XLSX.read(buffer, { type: "buffer" });
  const parsedSheet = parsedWorkbook.Sheets[parsedWorkbook.SheetNames[0]];
  const headerRows = XLSX.utils.sheet_to_json(parsedSheet, {
    header: 1,
    defval: "",
    blankrows: false
  });
  const headers = new Set(headerRows[0].map((header) => String(header).trim()));
  const missingColumns = requiredColumns.filter((column) => !headers.has(column));
  const parsedRows = XLSX.utils.sheet_to_json(parsedSheet, {
    defval: "",
    blankrows: false
  });
  const existing = await prisma.targetWebsite.findMany({
    where: { userId: user.id },
    select: { websiteUrl: true }
  });
  const seen = new Set(existing.map((website) => normalizeUrl(website.websiteUrl)));

  let duplicateRows = 0;
  let failedRows = 0;
  let savedRows = 0;

  for (const row of parsedRows) {
    const websiteName = String(row.websiteName ?? "").trim();
    const websiteUrl = String(row.websiteUrl ?? "").trim();
    const contactPageUrl = String(row.contactPageUrl ?? "").trim();
    const status = String(row.status ?? "").trim().toLowerCase();

    if (!websiteName || !websiteUrl || !contactPageUrl || !["active", "inactive"].includes(status)) {
      failedRows += 1;
      continue;
    }

    const normalizedUrl = normalizeUrl(websiteUrl);
    if (seen.has(normalizedUrl)) {
      duplicateRows += 1;
      continue;
    }

    seen.add(normalizedUrl);
    savedRows += 1;
    const createdWebsite = await prisma.targetWebsite.create({
      data: {
        websiteName,
        websiteUrl,
        contactPageUrl,
        status,
        notes: String(row.notes ?? "").trim() || null,
        userId: user.id
      }
    });
    createdWebsiteIds.push(createdWebsite.id);
  }

  console.log(
    JSON.stringify(
      {
        missingColumns,
        totalRows: parsedRows.length,
        savedRows,
        duplicateRows,
        failedRows
      },
      null,
      2
    )
  );
} finally {
  if (createdWebsiteIds.length > 0) {
    await prisma.targetWebsite.deleteMany({
      where: { id: { in: createdWebsiteIds } }
    });
  }
  await prisma.$disconnect();
}
