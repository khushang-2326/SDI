import { chromium } from 'playwright';
import { submitCalendlyBooking } from '../services/calendly-booking-automation';
import { LeadData } from '../types/automation';

const leadData: LeadData = {
  fullName: 'John Doe',
  email: 'johndoe@example.com',
  mobile: '+15550192834',
  address: '123 Main St, New York, NY',
  message: 'Meeting inquiry',
  companyName: 'Acme Growth'
};

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();

  const urlWithStaleMonth = 'https://calendly.com/intuitia-tech/30min?month=2025-08';
  console.log('Testing Calendly with stale month parameter:', urlWithStaleMonth);

  const res = await submitCalendlyBooking({
    websiteUrl: urlWithStaleMonth,
    leadData,
    bookingPreferences: { fallbackToFirstAvailableSlot: true },
    liveSubmit: false,
    browserContext: context,
    skipPersist: true,
    timeoutMs: 30000
  });

  console.log('Calendly status:', res.status);
  console.log('Selected date:', res.selectedDate);
  console.log('Selected time:', res.selectedTime);
  console.log('Error:', res.errorMessage);

  await browser.close();
}

main().catch(console.error);
