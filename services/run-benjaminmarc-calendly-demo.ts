import { submitCalendlyBooking } from "@/services/calendly-booking-automation";

const liveSubmit = process.argv.includes("--live");
const websiteUrl = process.argv.find((argument) => /^https?:\/\//i.test(argument)) ??
  "https://www.benjaminmarc.com/contact/";

async function main() {
  const result = await submitCalendlyBooking({
    websiteUrl,
    liveSubmit,
    bookingPreferences: {
      preferredDate: process.env.PREFERRED_DATE,
      preferredTime: process.env.PREFERRED_TIME,
      timezone: process.env.PREFERRED_TIMEZONE,
      fallbackToFirstAvailableSlot: true
    },
    leadData: {
      fullName: "Demo Lead",
      email: "demo.lead@example.com",
      mobile: "5551234567",
      address: "123 Demo Street, New York, NY",
      message:
        "Hello, this is a demo inquiry from the Lead Auto Submitter Calendly automation.",
      companyName: "Demo Company"
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
