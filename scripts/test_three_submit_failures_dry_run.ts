import { chromium } from 'playwright';
import { submitContactForm } from '../services/contact-form-automation';
import { LeadData } from '../types/automation';

const leadData: LeadData = {
  fullName: 'John Doe',
  email: 'johndoe@example.com',
  mobile: '+15550192834',
  address: '123 Main St, New York, NY',
  message: 'Hello, I am inquiring about your services. Please get in touch.',
  companyName: 'Acme Growth'
};

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const urls = [
    'https://www.efficiencymedia.com/contact',
    'https://triscari.com/contact/',
    'https://thefouriq.com/contact-us/'
  ];

  for (const url of urls) {
    console.log('\n========================================');
    console.log('RUNNING submitContactForm ON:', url);
    console.log('========================================');
    try {
      const result = await submitContactForm({
        websiteUrl: url,
        leadData,
        submit: false,
        browserContext: context,
        skipPersist: true,
        timeoutMs: 45000
      });
      console.log('RESULT:', result.status);
      console.log('Filled fields:', result.filledFields);
      console.log('Skipped fields:', result.skippedFields);
      console.log('Error message:', result.errorMessage);
    } catch (e: any) {
      console.error('EXCEPTION:', e.message);
    }
  }
  await browser.close();
}

main().catch(console.error);
