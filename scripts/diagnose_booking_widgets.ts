import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const urls = [
    'https://muslimadnetwork.pipedrive.com/scheduler/9KmA9sa/muslim-ad-network-advertising-partnership-next-steps',
    'https://avalanchegr.com/contact'
  ];

  for (const url of urls) {
    console.log('\n========================================');
    console.log('DIAGNOSING BOOKING WIDGET ON:', url);
    console.log('========================================');
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      const info = await page.evaluate(() => {
        const title = document.title;
        const text = document.body.innerText;
        const iframes = Array.from(document.querySelectorAll('iframe')).map(i => ({
          src: i.src,
          id: i.id,
          name: i.name,
          w: i.getBoundingClientRect().width,
          h: i.getBoundingClientRect().height,
          visible: i.getBoundingClientRect().width > 0 && i.getBoundingClientRect().height > 0
        }));
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.btn')).map(b => ({
          tag: b.tagName,
          text: b.textContent?.trim().slice(0, 50),
          ariaLabel: b.getAttribute('aria-label'),
          visible: b.getBoundingClientRect().width > 0
        })).slice(0, 15);

        const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')).filter(s => /calendly|pipedrive|hubspot|booking|scheduler|acuity/i.test(s || ''));

        return {
          title,
          textSnippet: text.slice(0, 400),
          iframes,
          buttons,
          scripts
        };
      });

      console.log('DIAGNOSTICS:', JSON.stringify(info, null, 2));
    } catch (e: any) {
      console.error('Error on', url, e.message);
    } finally {
      await page.close();
    }
  }
  await browser.close();
}

main().catch(console.error);
