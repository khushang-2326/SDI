import { jsPDF } from "jspdf";
import autoTable, { UserOptions } from "jspdf-autotable";

export type PdfTargetItem = {
  index: number;
  name: string;
  url: string;
  status: string;
  isSuccess: boolean;
  targetType?: string;
  trialsCount: number;
  successfulTrialsCount: number;
  filledFieldsCount?: number;
  verifiedFieldsCount?: number;
  detail: string;
  durationSec?: number;
};

export type PerformanceReportPdfData = {
  jobId?: string | null;
  batchStatus: string;
  totalWebsites: number;
  successWebsitesCount: number;
  failedWebsitesCount: number;
  pendingWebsitesCount: number;
  successRate: string;
  failureRate: string;
  totalTrialsExecuted: number;
  totalTrialsSuccessful: number;
  runtime?: string;
  categoryCounts: Record<string, number>;
  items: PdfTargetItem[];
};

function formatTimestampForFilename(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}-${min}`;
}

export function generatePerformanceReportPdf(data: PerformanceReportPdfData): { filename: string; blob: Blob } {
  // A4 Portrait: 210mm x 297mm
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const generatedAt = `${dateStr} at ${timeStr}`;
  const filename = `automation-performance-report-${formatTimestampForFilename(now)}.pdf`;

  // --- Palette ---
  const primaryNavy = [15, 23, 42] as [number, number, number]; // #0f172a
  const accentIndigo = [99, 102, 241] as [number, number, number]; // #6366f1
  const successGreen = [16, 185, 129] as [number, number, number]; // #10b981
  const errorRed = [239, 68, 68] as [number, number, number]; // #ef4444
  const lightBg = [248, 250, 252] as [number, number, number]; // #f8fafc
  const slateText = [51, 65, 85] as [number, number, number]; // #334155
  const mutedText = [100, 116, 139] as [number, number, number]; // #64748b
  const cardBorder = [226, 232, 240] as [number, number, number]; // #e2e8f0

  // --- Header Banner ---
  doc.setFillColor(...primaryNavy);
  doc.rect(0, 0, 210, 32, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Automation Performance Analysis", 14, 14);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225); // #cbd5e1
  doc.text("Detailed success vs failure metrics across all website targets", 14, 21);

  // Batch Status Badge (Right aligned in banner)
  const isCompleted = data.batchStatus.toLowerCase() === "completed";
  const badgeColor = isCompleted ? successGreen : [245, 158, 11] as [number, number, number];
  doc.setFillColor(...badgeColor);
  doc.roundedRect(162, 10, 34, 7, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(data.batchStatus.toUpperCase(), 179, 14.8, { align: "center" });

  // Metadata sub-bar
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated: ${generatedAt}  |  Job ID: ${data.jobId || "Local / Standalone Run"}`, 14, 28);

  let currentY = 38;

  // --- Executive KPI Summary Cards (5 columns) ---
  const cardWidth = 34.8;
  const cardHeight = 22;
  const gap = 2;
  const startX = 14;

  const kpis = [
    {
      title: "TOTAL TARGETS",
      value: String(data.totalWebsites),
      sub: "Websites in run",
      textColor: primaryNavy,
      bg: lightBg
    },
    {
      title: "SUCCEEDED",
      value: String(data.successWebsitesCount),
      sub: `${data.successRate}% success rate`,
      textColor: [5, 150, 105] as [number, number, number],
      bg: [236, 253, 245] as [number, number, number] // emerald-50
    },
    {
      title: "FAILED",
      value: String(data.failedWebsitesCount),
      sub: `${data.failureRate}% failed (0 succ.)`,
      textColor: [220, 38, 38] as [number, number, number],
      bg: [254, 242, 242] as [number, number, number] // red-50
    },
    {
      title: "TOTAL TRIALS",
      value: String(data.totalTrialsExecuted),
      sub: `${data.totalTrialsSuccessful} successful trials`,
      textColor: accentIndigo,
      bg: [238, 242, 255] as [number, number, number] // indigo-50
    },
    {
      title: "RUN DURATION",
      value: data.runtime || "N/A",
      sub: "Execution time",
      textColor: primaryNavy,
      bg: lightBg
    }
  ];

  kpis.forEach((kpi, idx) => {
    const x = startX + idx * (cardWidth + gap);
    doc.setFillColor(...kpi.bg);
    doc.setDrawColor(...cardBorder);
    doc.roundedRect(x, currentY, cardWidth, cardHeight, 2, 2, "FD");

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...mutedText);
    doc.text(kpi.title, x + 3, currentY + 5);

    // Value
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...kpi.textColor);
    doc.text(kpi.value, x + 3, currentY + 12);

    // Subtext
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...mutedText);
    doc.text(kpi.sub, x + 3, currentY + 18);
  });

  currentY += cardHeight + 6;

  // --- Failure Category Breakdown Section ---
  const activeCategories = Object.entries(data.categoryCounts)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (activeCategories.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryNavy);
    doc.text("Failure Reason Breakdown", 14, currentY + 2);
    currentY += 4;

    const categoryRows = activeCategories.map(([cat, count]) => {
      const pct = data.failedWebsitesCount > 0 ? ((count / data.failedWebsitesCount) * 100).toFixed(1) : "0.0";
      return [cat.replace(/_/g, " "), String(count), `${pct}%`];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: 14, right: 14 },
      head: [["Failure Category", "Failed Targets", "% of Failures"]],
      body: categoryRows,
      theme: "grid",
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontSize: 7.5,
        fontStyle: "bold",
        cellPadding: 2
      },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: slateText,
        lineColor: cardBorder,
        lineWidth: 0.15
      },
      columnStyles: {
        0: { cellWidth: 100, fontStyle: "bold" },
        1: { cellWidth: 40, halign: "center" },
        2: { cellWidth: 42, halign: "center" }
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // Check if we have enough room for the table header, else add page
  if (currentY > 240) {
    doc.addPage();
    currentY = 20;
  }

  // --- Full Target-by-Target Result Table ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...primaryNavy);
  doc.text("Target Details & Execution Results", 14, currentY);
  currentY += 4;

  const tableRows = data.items.map((item, idx) => {
    const statusText = item.isSuccess ? "SUCCESS" : "FAILED";
    const typeText = (item.targetType || "contact_form").replace(/_/g, " ");
    const trialsStr = `${item.successfulTrialsCount}/${item.trialsCount}`;
    const fieldsStr = item.filledFieldsCount !== undefined ? `${item.verifiedFieldsCount ?? 0}/${item.filledFieldsCount}` : "N/A";
    const cleanDetail = (item.detail || (item.isSuccess ? "Dry run ready to book" : "Failed execution")).replace(/\s+/g, " ");
    const timeStr = item.durationSec !== undefined ? `${item.durationSec}s` : "-";

    return [
      String(idx + 1),
      `${item.name}\n${item.url}`,
      statusText,
      typeText,
      trialsStr,
      fieldsStr,
      cleanDetail,
      timeStr
    ];
  });

  autoTable(doc, {
    startY: currentY,
    margin: { left: 14, right: 14, bottom: 16 },
    head: [["#", "Website / URL", "Result", "Type", "Trials", "Fields", "Execution Detail", "Time"]],
    body: tableRows,
    theme: "striped",
    showHead: "everyPage",
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: "bold",
      cellPadding: 2.5
    },
    styles: {
      fontSize: 6.5,
      cellPadding: 2,
      textColor: slateText,
      overflow: "linebreak",
      lineColor: cardBorder,
      lineWidth: 0.1
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 46, fontStyle: "normal" },
      2: { cellWidth: 16, halign: "center", fontStyle: "bold" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 12, halign: "center" },
      5: { cellWidth: 13, halign: "center" },
      6: { cellWidth: 58 },
      7: { cellWidth: 12, halign: "center" }
    },
    didParseCell: (hookData) => {
      if (hookData.section === "body" && hookData.column.index === 2) {
        if (hookData.cell.raw === "SUCCESS") {
          hookData.cell.styles.textColor = [5, 150, 105]; // green
          hookData.cell.styles.fontStyle = "bold";
        } else if (hookData.cell.raw === "FAILED") {
          hookData.cell.styles.textColor = [220, 38, 38]; // red
          hookData.cell.styles.fontStyle = "bold";
        }
      }
    }
  });

  // --- Add Page Number Footers to all pages ---
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...mutedText);

    // Left footer
    doc.text("Automation Performance Analysis Report  •  Confidential & Proprietary", 14, 290);

    // Right footer
    doc.text(`Page ${p} of ${totalPages}`, 196, 290, { align: "right" });

    // Subtle footer separator line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(14, 286, 196, 286);
  }

  const blob = doc.output("blob");
  return { filename, blob };
}
