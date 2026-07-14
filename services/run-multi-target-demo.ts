import { acquireContext, closePool, releaseContext } from "@/lib/browserPool";
import { runMultiTargetAutomation } from "@/services/multi-target-automation";

const websiteUrl = process.argv[2] ?? "https://www.iworkforyouservices.com/";

async function main() {
  const context = await acquireContext();
  try {
    const result = await runMultiTargetAutomation({
      websiteUrl,
      liveSubmit: false,
      browserContext: context,
      timeoutMs: 45000,
      leadData: {
        fullName: "Demo Lead",
        email: "demo.lead@example.com",
        mobile: "5551234567",
        companyName: "Demo Company",
        address: "123 Demo Street, New York, NY",
        message: "Hello, this is a dry-run inquiry from the multi-target workflow."
      },
      bookingPreferences: {
        timezone: "Asia/Calcutta",
        fallbackToFirstAvailableSlot: true
      }
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await releaseContext(context);
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
