import { chromium } from "playwright";
import { getChromiumExecutablePath } from "../services/browser-executable.ts";
import { submitCalendlyBooking } from "../services/calendly-booking-automation.ts";

async function testFull() {
  console.log("Starting full Calendly automation test on https://bigbuda.cl/agendar...");
  const result = await submitCalendlyBooking({
    websiteUrl: "https://bigbuda.cl/agendar",
    leadData: {
      fullName: "Juan Perez",
      email: "juan.perez@testcompany.cl",
      mobile: "+56912345678",
      message: "Consulta de agendamiento para estrategia digital."
    },
    bookingPreferences: {
      preferredDate: "September 7",
      preferredTime: "6:00pm",
      fallbackToFirstAvailableSlot: true
    },
    liveSubmit: false,
    headless: true,
    timeoutMs: 45000,
    skipPersist: true
  });

  console.log("=== AUTOMATION RESULT ===");
  console.log("Status:", result.status);
  console.log("Error:", result.errorMessage);
  console.log("Selected Date:", result.selectedDate);
  console.log("Selected Time:", result.selectedTime);
  console.log("Filled Fields:", result.filledFields);
  console.log("Skipped Fields:", result.skippedFields);
  console.log("Screenshots:", result.screenshotPaths);
}

testFull().catch(console.error);
