import { chromium } from 'playwright';
import { submitContactForm } from '../services/contact-form-automation';
import { LeadData } from '../types/automation';

const leadData: LeadData = {
  fullName: 'John Doe',
  email: 'johndoe@example.com',
  mobile: '+15550192834',
  address: '123 Main St, New York, NY',
  message: 'Hello, I am inquiring about your services.',
  companyName: 'Acme Growth'
};

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const urls = [
    'https://blufish.com/contact/',
    'https://www.weareqry.com/strategy-call',
    'https://notixit.com/contact'
  ];

  for (const url of urls) {
    console.log('\n========================================');
    console.log('DIAGNOSING TIMEOUT ON:', url);
    console.log('========================================');
    const context = await browser.newContext();
    const page = await context.newPage();

    let reqCount = 0;
    let pendingReqs = new Set<string>();
    page.on('request', req => {
      reqCount++;
      pendingReqs.add(req.url());
    });
    page.on('requestfinished', req => pendingReqs.delete(req.url()));
    page.on('requestfailed', req => pendingReqs.delete(req.url()));

    const t0 = Date.now();
    try {
      console.log('Step 1: Navigating with domcontentloaded...');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log(`DOMContentLoaded in ${Date.now() - t0}ms, pending requests: ${pendingReqs.size}`);

      // Check forms and inputs
      const forms = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('form')).map(f => ({
          id: f.id,
          action: f.action,
          inputs: Array.from(f.querySelectorAll('input, textarea')).map(i => ({
            type: i.getAttribute('type'),
            name: i.getAttribute('name'),
            visible: i.getBoundingClientRect().width > 0
          }))
        }));
      });
      console.log(`Found ${forms.length} forms on page.`);

      // Now run submitContactForm with a 35s budget
      console.log('Step 2: Testing submitContactForm...');
      const tSubmit0 = Date.now();
      const res = await submitContactForm({
        websiteUrl: url,
        leadData,
        submit: false,
        browserContext: context,
        skipPersist: true,
        timeoutMs: 35000
      });
      console.log(`submitContactForm completed in ${Date.now() - tSubmit0}ms: status=${res.status}, error=${res.errorMessage}`);
    } catch (e: any) {
      console.error(`ERROR after ${Date.now() - t0}ms:`, e.message);
    } finally {
      await context.close();
    }
  }
  await browser.close();
}

main().catch(console.error);
