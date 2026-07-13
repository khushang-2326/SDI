import { submitHubSpotBooking } from "@/services/hubspot-booking-automation";

const websiteUrl =
  process.argv[2] ??
  "https://meetings.hubspot.com/michael-natole?uuid=74a6d835-6a83-4ef3-b1a5-056f962fcc10";
const liveSubmit = process.argv.includes("--live");

async function main() {
  const result = await submitHubSpotBooking({
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
      preferredDate: "July 6",
      preferredTime: "9:30 pm",
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
