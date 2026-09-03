import { submitCalendlyBooking } from "../services/calendly-booking-automation.ts";

async function run() {
  const leadData = {
    firstName: "Carlos",
    lastName: "Mendoza",
    fullName: "Carlos Mendoza",
    email: "carlos.mendoza@testmail.com",
    mobile: "+56912345678",
    companyName: "Tech Solutions",
    website: "https://techsolutions.cl",
    message: "Hola, queremos agendar una reunión para ver opciones de crecimiento."
  };

  const bookingPreferences = {
    preferredDate: "July 7",
    preferredTime: "9:30am",
    fallbackToFirstAvailableSlot: true
  };

  console.log("Starting submitCalendlyBooking for https://bigbuda.cl/agendar...");
  const result = await submitCalendlyBooking({
    websiteUrl: "https://bigbuda.cl/agendar",
    leadData,
    bookingPreferences,
    liveSubmit: false,
    headless: true,
    skipPersist: true,
    timeoutMs: 45000
  });

  console.log("=== AUTOMATION FINISHED ===");
  console.log("Result status:", result.status);
  console.log("Error message:", result.errorMessage);
  console.log("Selected date:", result.selectedDate);
  console.log("Selected time:", result.selectedTime);
  console.log("Filled fields:", result.filledFields);
  console.log("Skipped fields:", result.skippedFields);
  console.log("Screenshot paths:", result.screenshotPaths);
}

run().catch(console.error);
