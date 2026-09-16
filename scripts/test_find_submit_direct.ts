import { chromium } from 'playwright';
import { findSubmitButton } from '../services/contact-form-automation';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const urls = [
    'https://www.efficiencymedia.com/contact',
    'https://triscari.com/contact/',
    'https://thefouriq.com/contact-us/'
  ];

  for (const url of urls) {
    console.log('\n========================================');
    console.log('TESTING findSubmitButton ON:', url);
    console.log('========================================');
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const form = page.locator('form').first();
      const formCount = await page.locator('form').count();
      console.log('Forms on page:', formCount);

      const btn = await findSubmitButton(page, undefined, formCount > 0 ? form : null);
      if (btn) {
        const text = await btn.innerText().catch(() => '');
        const tag = await btn.evaluate(el => el.tagName).catch(() => '');
        const type = await btn.getAttribute('type').catch(() => null);
        console.log(`FOUND submit button: <${tag} type="${type}"> text="${text.trim()}"`);
      } else {
        console.log('findSubmitButton returned NULL!');

        // Let's debug why it returned NULL!
        const debug = await page.evaluate(() => {
          const f = document.querySelector('form');
          if (!f) return { error: 'no form' };
          const btns = Array.from(f.querySelectorAll('button, input[type="submit"]'));
          return btns.map(b => ({
            tag: b.tagName,
            type: b.getAttribute('type'),
            text: b.textContent?.trim(),
            display: window.getComputedStyle(b).display,
            visibility: window.getComputedStyle(b).visibility,
            w: b.getBoundingClientRect().width,
            h: b.getBoundingClientRect().height,
            offsetParent: Boolean((b as HTMLElement).offsetParent)
          }));
        });
        console.log('Debug buttons in form:', debug);
      }
    } catch (e: any) {
      console.error('Error:', e.message);
    } finally {
      await page.close();
    }
  }
  await browser.close();
}

main().catch(console.error);
