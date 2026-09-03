import * as XLSX from "xlsx";
import { acquireContext, closePool } from "../lib/browserPool";
import { discoverSubmissionTarget } from "../services/submission-target-discovery";
import { submitContactForm } from "../services/contact-form-automation";
import { submitCalendlyBooking } from "../services/calendly-booking-automation";
import { submitGenericBookingWidget } from "../services/generic-booking-widget-automation";
import { LeadData } from "../types/automation";

async function runFullDataset() {
  const filePath = "C:\\Users\\HP\\Downloads\\Aug contact us.xlsx";
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);

  console.log(`Loaded ${rows.length} rows from dataset.`);

  const browserContext = await acquireContext({ headless: true });

  const leadData: LeadData = {
    fullName: "Alex Rivera",
    email: "alex.rivera@example.com",
    mobile: "+14155552671",
    message: "Hi, I am interested in your services and would love to discuss a potential partnership."
  };

  const results: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawUrl = row["Website"] || row["url"] || row["URL"] || row["website"] || Object.values(row)[0];
    const name = row["Name"] || row["Company"] || `Target ${i + 1}`;

    console.log(`\n[${i + 1}/${rows.length}] Testing: ${name} (${rawUrl})`);

    let status = "failed";
    let error: string | null = null;
    let filledFields: string[] = [];
    let targetType = "unknown";

    try {
      // 1. Run Discovery
      const discovery = await discoverSubmissionTarget({
        websiteUrl: rawUrl,
        browserContext
      });

      targetType = discovery.targetType || "contact";
      const targetUrl = discovery.discoveredUrl || rawUrl;
      console.log(`  Discovery: type=${discovery.targetType}, url=${discovery.discoveredUrl}`);

      // 2. Run Submission
      let submitRes: any;
      if (targetType === "calendly" || (targetUrl && targetUrl.includes("calendly.com"))) {
        submitRes = await submitCalendlyBooking({
          websiteUrl: targetUrl,
          leadData,
          bookingPreferences: { fallbackToFirstAvailableSlot: true },
          liveSubmit: false,
          browserContext,
          skipPersist: true
        });
      } else if (targetType === "booking_widget") {
        submitRes = await submitGenericBookingWidget({
          websiteUrl: targetUrl,
          leadData,
          bookingPreferences: { fallbackToFirstAvailableSlot: true },
          liveSubmit: false,
          browserContext,
          skipPersist: true
        });
      } else {
        submitRes = await submitContactForm({
          websiteUrl: targetUrl,
          leadData,
          liveSubmit: false,
          browserContext,
          skipPersist: true
        });
      }

      status = submitRes.status;
      error = submitRes.errorMessage;
      filledFields = submitRes.filledFields || [];
      console.log(`  Result: status=${status}, error=${error}, fields=${filledFields.join(",")}`);
    } catch (err: any) {
      status = "error";
      error = err.message;
      console.log(`  Result: error=${err.message}`);
    }

    const isSuccess = ["success", "dry_run_ready_to_book", "booking_widget_found"].includes(status);

    results.push({
      index: i + 1,
      name,
      url: rawUrl,
      targetType,
      status,
      isSuccess,
      error,
      filledFields: filledFields.join(", ")
    });
  }

  await closePool();

  console.log("\n=================================================================");
  console.log("FINAL FULL DATASET AUTOMATION ANALYSIS REPORT");
  console.log("=================================================================");
  const successfulCount = results.filter(r => r.isSuccess).length;
  console.log(`Total Targets Analyzed: ${results.length}`);
  console.log(`✓ Succeeded Automations: ${successfulCount} (${Math.round(successfulCount / results.length * 100)}%)`);
  console.log(`✕ Failed Automations: ${results.length - successfulCount}`);
  console.log("\nDETAILED BREAKDOWN:");
  results.forEach(r => {
    console.log(`${r.index}. [${r.isSuccess ? "SUCCESS" : "FAILED"}] ${r.name} (${r.url})`);
    console.log(`   Type: ${r.targetType} | Status: ${r.status} | Filled: [${r.filledFields}] | Error: ${r.error || "None"}`);
  });
}

runFullDataset().catch(console.error);
