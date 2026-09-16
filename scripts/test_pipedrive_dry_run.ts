import { chromium } from 'playwright';
import { submitGenericBookingWidget } from '../services/generic-booking-widget-automation';
import { LeadData } from '../types/automation';

const leadData: LeadData = {
  fullName: 'John Doe',
  email: 'johndoe@example.com',
  mobile: '+15550192834',
  address: '123 Main St, New York, NY',
  message: 'Inquiry message',
  companyName: 'Acme Growth'
};

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const url = 'https://muslimadnetwork.pipedrive.com/scheduler/9KmA9sa/muslim-ad-network-advertising-partnership-next-steps';

  console.log('Testing submitGenericBookingWidget on Pipedrive...');
  const res = await submitGenericBookingWidget({
    websiteUrl: url,
    leadData,
    bookingPreferences: { fallbackToFirstAvailableSlot: true },
    liveSubmit: false,
    browserContext: context,
    skipPersist: true,
    timeoutMs: 35000
  });

  console.log('Result status:', res.status);
  console.log('Selected date:', res.selectedDate);
  console.log('Selected time:', res.selectedTime);
  console.log('Error:', res.errorMessage);

  await browser.close();
}

main().catch(console.error);
