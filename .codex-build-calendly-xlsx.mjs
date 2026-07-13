import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const urls = [
  "https://calendly.com/experienceamplified/discovery-call_30-min",
  "https://calendly.com/calebjones/discovery-call-with-caleb-jones",
  "https://calendly.com/rhclee/30-minute-meeting-clone",
  "https://calendly.com/stephen-badges/30-minute-meeting",
  "https://calendly.com/andrew-barker",
  "https://calendly.com/tara-zinc/30-minute-meeting",
  "https://calendly.com/samalleva/complimentary-call",
  "https://calendly.com/afia-growthaccelerators/30min",
  "https://calendly.com/thebeaconsvanessa/30min",
  "https://calendly.com/d/2tv-6vj-z9p/pdq-connect-customer-feedback"
];
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Calendly URLs");
sheet.getRange("A1:C11").values = [["No.", "website", "testMode"], ...urls.map((url, i) => [i + 1, url, "dry"])];
sheet.getRange("A1:C1").format = { fill: "#4F46E5", font: { bold: true, color: "#FFFFFF" }, rowHeight: 26 };
sheet.getRange("A2:A11").format.numberFormat = "0";
sheet.getRange("A1:A11").format.columnWidth = 8;
sheet.getRange("B1:B11").format.columnWidth = 62;
sheet.getRange("C1:C11").format.columnWidth = 14;
sheet.freezePanes.freezeRows(1);
sheet.tables.add("A1:C11", true, "CalendlyUrlsTable");
const outputDir = "outputs/calendly-test-urls";
await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "Calendly URLs", range: "A1:C11", scale: 1.3, format: "png" });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const check = await workbook.inspect({ kind: "table", range: "Calendly URLs!A1:C11", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 4 });
console.log(check.ndjson);
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/calendly_10_verified_public_urls.xlsx`);
