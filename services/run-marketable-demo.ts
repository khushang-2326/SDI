import { submitGenericBookingWidget } from "@/services/generic-booking-widget-automation";

const websiteUrl = process.argv[2] ?? "https://www.marketablebranding.com/discovery-call";
const liveSubmit = process.argv.includes("--live");

async function main() {
  const result = await submitGenericBookingWidget({
    websiteUrl,
    liveSubmit,
    leadData: {
      fullName: "Demo Lead",
      email: "demo.lead@example.com",
      mobile: "5551234567",
      companyName: "Demo Company",
      address: "123 Demo Street, New York, NY",
      message: "Hello, this is a demo inquiry from the dashboard workflow."
    },
    bookingPreferences: {
      preferredDate: "July 22",
      preferredTime: "12:00 AM",
      timezone: "Asia/Calcutta",
      fallbackToFirstAvailableSlot: true
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
